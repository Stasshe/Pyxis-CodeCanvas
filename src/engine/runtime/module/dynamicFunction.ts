import { ModuleCode } from './moduleCode';

/** Function-created code keeps global scope and closes only the module import callback. */
export function createRuntimeFunction(
  importModule: (specifier: string) => Promise<unknown>
): FunctionConstructor {
  const NativeFunction = Function;
  const create = (argumentsList: string[], newTarget: Function = NativeFunction): Function => {
    const parameters = argumentsList.map(String);
    const body = parameters.pop() || '';
    const transformed = ModuleCode.runtimeCode(body);
    const native = Reflect.construct(NativeFunction, [...parameters, body], newTarget);
    if (transformed === body) return native;

    // A native factory prevents access to the calling module's lexical bindings.
    const factory = NativeFunction(
      '__pyxisImport',
      `return function anonymous(${parameters.join(',')}\n) {\n${transformed}\n};`
    );
    const result: Function = factory(importModule);
    Object.setPrototypeOf(result, Object.getPrototypeOf(native));
    return result;
  };

  return new Proxy(NativeFunction, {
    apply(_target, _thisArgument, argumentsList: string[]) {
      return create(argumentsList);
    },
    construct(_target, argumentsList: string[], newTarget) {
      return create(argumentsList, newTarget);
    },
  });
}
