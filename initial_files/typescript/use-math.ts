// ES Module使用例 - math.tsのインポート

// デフォルトインポート
import MathUtils from './math';

// 名前付きインポート
import { add, subtract, multiply, divide, PI, Calculator } from './math';

// すべてインポート
import * as MathModule from './math';

console.log('=== 基本的な算術演算 ===');
console.log('10 + 5 =', add(10, 5));
console.log('10 - 5 =', subtract(10, 5));
console.log('10 * 5 =', multiply(10, 5));
console.log('10 / 5 =', divide(10, 5));

console.log('\n=== 定数 ===');
console.log('PI =', PI);
console.log('円の面積 (r=5):', PI * 5 * 5);

console.log('\n=== Calculatorクラス ===');
const calc = new Calculator(10);
const result = calc
  .add(5)
  .multiply(2)
  .subtract(10)
  .getValue();
console.log('(10 + 5) * 2 - 10 =', result);

console.log('\n=== MathUtilsクラス ===');
console.log('5の2乗 =', MathUtils.square(5));
console.log('3の3乗 =', MathUtils.cube(3));
console.log('√16 =', MathUtils.sqrt(16));
console.log('2の10乗 =', MathUtils.power(2, 10));

console.log('\n=== 名前空間インポート ===');
console.log('MathModule.add(3, 4) =', MathModule.add(3, 4));
console.log('MathModule.PI =', MathModule.PI);
console.log('MathModule.default.square(7) =', MathModule.default.square(7));
