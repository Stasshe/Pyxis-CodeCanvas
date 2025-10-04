// TypeScript基本サンプル - Hello World

// 型アノテーション付き変数
const message: string = 'Hello, TypeScript!';
const count: number = 42;
const isActive: boolean = true;

// 関数の型定義
function greet(name: string): string {
  return `Hello, ${name}!`;
}

// インターフェース定義
interface User {
  name: string;
  age: number;
  email?: string; // オプショナルプロパティ
}

// インターフェースを使用した関数
function createUser(name: string, age: number): User {
  return {
    name,
    age,
  };
}

// ジェネリクス関数
function identity<T>(value: T): T {
  return value;
}

// 実行
console.log(message);
console.log(`Count: ${count}`);
console.log(`Active: ${isActive}`);

console.log(greet('TypeScript'));

const user = createUser('Alice', 25);
console.log('User:', user);

const numResult = identity<number>(100);
const strResult = identity<string>('Hello');
console.log('Identity results:', numResult, strResult);
