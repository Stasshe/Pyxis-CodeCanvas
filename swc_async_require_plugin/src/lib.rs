#[cfg(test)]
mod tests {
    use super::*;
    use swc_core::ecma::parser::{Parser, StringInput, Syntax, EsConfig};
    use swc_core::ecma::codegen::{Emitter, text_writer::JsWriter, Config as CodegenConfig};
    use swc_core::ecma::visit::VisitMutWith;
    use swc_core::ecma::ast::Program;
    use std::sync::Arc;
    use swc_core::common::{FileName, SourceMap, DUMMY_SP};

    fn parse_js(src: &str) -> Program {
        let cm = Arc::new(SourceMap::default());
        let fm = cm.new_source_file(FileName::Custom("test.js".into()), src.into());
        let mut parser = Parser::new(Syntax::Es(EsConfig::default()), StringInput::from(&*fm), None);
        parser.parse_program().unwrap()
    }

    #[test]
    fn test_require_call_marked() {
    let mut program = parse_js("const x = require('foo');");
    let mut transformer = super::AsyncRequireTransform::new();
    program.visit_mut_with(&mut transformer);
        // 変換後ASTに__require__が現れることを確認
        let mut found = false;
        struct FindRequire<'a> { found: &'a mut bool }
        impl<'a> VisitMut for FindRequire<'a> {
            fn visit_mut_call_expr(&mut self, n: &mut CallExpr) {
                if let Callee::Expr(expr) = &n.callee {
                    if let Expr::Ident(Ident { sym, .. }) = &**expr {
                        if sym == "__require__" {
                            *self.found = true;
                        }
                    }
                }
            }
        }
        program.visit_mut_with(&mut FindRequire { found: &mut found });
        assert!(found, "__require__ not found in AST");
    }
    #[test]
    fn test_imports_and_exports_marked() {
        let srcs = vec![
            ("import foo from 'bar';", "__require__"),
            ("import {foo} from 'bar';", "__require__"),
            ("import * as ns from 'bar';", "__require__"),
            ("import 'bar';", "__require__"),
            ("const x = import('bar');", "__import__"),
            ("export default 1;", "module"),
            ("export const foo = 1;", "module"),
        ];

        for (src, expect_sub) in srcs {
            let mut program = parse_js(src);
            let mut transformer = super::AsyncRequireTransform::new();
            program.visit_mut_with(&mut transformer);
            let mut found = false;
            struct Finder<'a> { expected: &'a str, found: &'a mut bool }
            impl<'a> VisitMut for Finder<'a> {
                fn visit_mut_call_expr(&mut self, n: &mut CallExpr) {
                    if let Callee::Expr(expr) = &n.callee {
                        if let Expr::Ident(Ident { sym, .. }) = &**expr {
                            if sym.to_string().contains(self.expected) {
                                *self.found = true;
                            }
                        }
                    }
                }
                fn visit_mut_member_expr(&mut self, n: &mut MemberExpr) {
                    if let Expr::Ident(Ident { sym, .. }) = &*n.obj {
                        if sym == "module" {
                            *self.found = true;
                        }
                    }
                }
            }
            program.visit_mut_with(&mut Finder { expected: expect_sub, found: &mut found });
            assert!(found, "expected '{}' to be present in transformed AST for source: {}", expect_sub, src);
        }
    }
}
use swc_core::common::DUMMY_SP;
use swc_core::ecma::ast::*;
use swc_core::ecma::visit::{as_folder, VisitMut, VisitMutWith};
use wasm_bindgen::prelude::*;

pub struct AsyncRequireTransform {
    tmp_counter: usize,
}

impl AsyncRequireTransform {
    pub fn new() -> Self {
        Self { tmp_counter: 0 }
    }
    fn next_tmp(&mut self) -> String {
        let id = format!("__mod_{}__", self.tmp_counter);
        self.tmp_counter += 1;
        id
    }
}

impl VisitMut for AsyncRequireTransform {
    fn visit_mut_program(&mut self, program: &mut Program) {
        match program {
            Program::Module(m) => {
                let mut new_body: Vec<ModuleItem> = Vec::new();
                for item in m.body.drain(..) {
                    match item {
                        ModuleItem::ModuleDecl(ModuleDecl::Import(import_decl)) => {
                            // Build variable declarators for specifiers
                            if !import_decl.specifiers.is_empty() {
                                let mut decls: Vec<VarDeclarator> = Vec::new();
                                for spec in import_decl.specifiers {
                                    match spec {
                                        ImportSpecifier::Default(default_spec) => {
                                            let id = default_spec.local;
                                            // const id = await __require__('source');
                                            let call = Expr::Call(CallExpr {
                                                span: DUMMY_SP,
                                                callee: Callee::Expr(Box::new(Expr::Ident(Ident::new("__require__".into(), DUMMY_SP)))),
                                                args: vec![ExprOrSpread {
                                                    spread: None,
                                                    expr: Box::new(Expr::Lit(Lit::Str(Str { span: DUMMY_SP, value: import_decl.src.value.clone(), raw: None }))),
                                                }],
                                                type_args: None,
                                            });
                                            let await_expr = Expr::Await(AwaitExpr { span: DUMMY_SP, arg: Box::new(call) });
                                            decls.push(VarDeclarator { span: DUMMY_SP, name: Pat::Ident(BindingIdent { id, type_ann: None }), init: Some(Box::new(await_expr)), definite: false });
                                        }
                                        ImportSpecifier::Named(named_spec) => {
                                            // const local = (await __require__('src')).imported;
                                            let local = named_spec.local;
                                            let imported = match named_spec.imported {
                                                Some(ModuleExportName::Ident(i)) => i.sym.clone(),
                                                Some(ModuleExportName::Str(s)) => s.value.clone(),
                                                None => local.sym.clone(),
                                            };
                                            let call = Expr::Call(CallExpr {
                                                span: DUMMY_SP,
                                                callee: Callee::Expr(Box::new(Expr::Ident(Ident::new("__require__".into(), DUMMY_SP)))),
                                                args: vec![ExprOrSpread { spread: None, expr: Box::new(Expr::Lit(Lit::Str(Str { span: DUMMY_SP, value: import_decl.src.value.clone(), raw: None }))) }],
                                                type_args: None,
                                            });
                                            let await_call = Expr::Await(AwaitExpr { span: DUMMY_SP, arg: Box::new(call) });
                                            let member = Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(await_call), prop: MemberProp::Ident(Ident::new(imported, DUMMY_SP)), computed: false });
                                            decls.push(VarDeclarator { span: DUMMY_SP, name: Pat::Ident(BindingIdent { id: local, type_ann: None }), init: Some(Box::new(member)), definite: false });
                                        }
                                        ImportSpecifier::Namespace(ns_spec) => {
                                            let id = ns_spec.local;
                                            let call = Expr::Call(CallExpr {
                                                span: DUMMY_SP,
                                                callee: Callee::Expr(Box::new(Expr::Ident(Ident::new("__require__".into(), DUMMY_SP)))),
                                                args: vec![ExprOrSpread { spread: None, expr: Box::new(Expr::Lit(Lit::Str(Str { span: DUMMY_SP, value: import_decl.src.value.clone(), raw: None }))) }],
                                                type_args: None,
                                            });
                                            let await_expr = Expr::Await(AwaitExpr { span: DUMMY_SP, arg: Box::new(call) });
                                            decls.push(VarDeclarator { span: DUMMY_SP, name: Pat::Ident(BindingIdent { id, type_ann: None }), init: Some(Box::new(await_expr)), definite: false });
                                        }
                                    }
                                }
                                let var_decl = VarDecl { span: DUMMY_SP, kind: VarDeclKind::Const, declare: false, decls };
                                new_body.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(var_decl))));
                            } else {
                                // import 'mod'; -> await __require__('mod');
                                let call = Expr::Call(CallExpr { span: DUMMY_SP, callee: Callee::Expr(Box::new(Expr::Ident(Ident::new("__require__".into(), DUMMY_SP)))), args: vec![ExprOrSpread { spread: None, expr: Box::new(Expr::Lit(Lit::Str(Str { span: DUMMY_SP, value: import_decl.src.value.clone(), raw: None }))) }], type_args: None });
                                let await_expr = Expr::Await(AwaitExpr { span: DUMMY_SP, arg: Box::new(call) });
                                new_body.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt { span: DUMMY_SP, expr: Box::new(await_expr) })));
                            }
                        }
                        ModuleItem::Stmt(mut stmt) => {
                            // visit inside statement to transform calls
                            stmt.visit_mut_with(self);
                            new_body.push(ModuleItem::Stmt(stmt));
                        }
                        other => {
                            // For other module decls (exports), handle some conversions
                            match other {
                                ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ed)) => {
                                    // module.exports.default = <decl or expr>
                                    let assign = Expr::Assign(AssignExpr { span: DUMMY_SP, op: AssignOp::Assign, left: PatOrExpr::Expr(Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Ident(Ident::new("module".into(), DUMMY_SP))), prop: MemberProp::Ident(Ident::new("exports".into(), DUMMY_SP)), computed: false })), prop: MemberProp::Ident(Ident::new("default".into(), DUMMY_SP)), computed: false }))), right: Box::new(match ed.decl {
                                            DefaultDecl::Expr(boxed_expr) => *boxed_expr,
                                            DefaultDecl::Fn(f) => Expr::Fn(FnExpr { ident: f.ident.clone().map(|i| i.id), function: f.function }),
                                            DefaultDecl::Class(c) => Expr::Class(ClassExpr { ident: c.ident.clone().map(|i| i.id), class: c.class }),
                                        }));
                                    new_body.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt { span: DUMMY_SP, expr: Box::new(assign) })));
                                }
                                ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(named)) => {
                                    if let Some(decl) = named.decl {
                                        match decl {
                                            Decl::Var(var_decl) => {
                                                // keep the original var decl and add assignments
                                                new_body.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(var_decl.clone()))));
                                                for vd in var_decl.decls {
                                                    if let Pat::Ident(BindingIdent { id, .. }) = vd.name {
                                                        let assign = Expr::Assign(AssignExpr { span: DUMMY_SP, op: AssignOp::Assign, left: PatOrExpr::Expr(Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Ident(Ident::new("module".into(), DUMMY_SP))), prop: MemberProp::Ident(Ident::new("exports".into(), DUMMY_SP)), computed: false })), prop: MemberProp::Ident(Ident::new(id.sym.clone(), DUMMY_SP)), computed: false }))), right: Box::new(Expr::Ident(Ident::new(id.sym.clone(), DUMMY_SP)))});
                                                        new_body.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt { span: DUMMY_SP, expr: Box::new(assign) })));
                                                    }
                                                }
                                            }
                                            Decl::Fn(fn_decl) => {
                                                let name = fn_decl.ident.clone().unwrap().id.sym.clone();
                                                new_body.push(ModuleItem::Stmt(Stmt::Decl(Decl::Fn(fn_decl.clone()))));
                                                let assign = Expr::Assign(AssignExpr { span: DUMMY_SP, op: AssignOp::Assign, left: PatOrExpr::Expr(Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Ident(Ident::new("module".into(), DUMMY_SP))), prop: MemberProp::Ident(Ident::new("exports".into(), DUMMY_SP)), computed: false })), prop: MemberProp::Ident(Ident::new(name.clone(), DUMMY_SP)), computed: false }))), right: Box::new(Expr::Ident(Ident::new(name.clone(), DUMMY_SP)))});
                                                new_body.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt { span: DUMMY_SP, expr: Box::new(assign) })));
                                            }
                                            _ => {
                                                new_body.push(ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(named)));
                                            }
                                        }
                                    } else {
                                        // export { a, b }
                                        let mut assigns: Vec<ModuleItem> = vec![];
                                        for spec in named.specifiers {
                                            if let ExportSpecifier::Namespace(ns) = spec {
                                                assigns.push(ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(ExportNamedDecl { span: DUMMY_SP, decl: None, specifiers: vec![], src: None })));
                                            } else if let ExportSpecifier::Named(named_spec) = spec {
                                                let exported = named_spec.exported.sym.clone();
                                                let local = named_spec.orig.sym.clone();
                                                let assign = Expr::Assign(AssignExpr { span: DUMMY_SP, op: AssignOp::Assign, left: PatOrExpr::Expr(Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Member(MemberExpr { span: DUMMY_SP, obj: Box::new(Expr::Ident(Ident::new("module".into(), DUMMY_SP))), prop: MemberProp::Ident(Ident::new("exports".into(), DUMMY_SP)), computed: false })), prop: MemberProp::Ident(Ident::new(exported.clone(), DUMMY_SP)), computed: false }))), right: Box::new(Expr::Ident(Ident::new(local.clone(), DUMMY_SP)))});
                                                new_body.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt { span: DUMMY_SP, expr: Box::new(assign) })));
                                            }
                                        }
                                        // append assigns
                                    }
                                }
                                _ => new_body.push(other),
                            }
                        }
                    }
                }
                m.body = new_body;
            }
            Program::Script(_) => {}
        }
    }

    fn visit_mut_call_expr(&mut self, n: &mut CallExpr) {
        // transform require('x') to __require__('x') and import() to __import__
        if let Callee::Expr(expr) = &mut n.callee {
            if let Expr::Ident(ident) = &mut **expr {
                if ident.sym == *"require" {
                    ident.sym = "__require__".into();
                }
            }
        }
        if let Callee::Import(_) = &n.callee {
            n.callee = Callee::Expr(Box::new(Expr::Ident(Ident::new("__import__".into(), DUMMY_SP))));
        }
    }
}

#[wasm_bindgen]
pub fn process_plugin(program: JsValue) -> JsValue {
    let mut program: Program = program.into_serde().unwrap();
    let mut transformer = AsyncRequireTransform::new();
    program.visit_mut_with(&mut transformer);
    JsValue::from_serde(&program).unwrap()
}
