/**
 * Test Multi-File Extension Entry Point
 * このエントリーファイルは他のモジュールをimportして使用する
 */

import { helperFunction, HelperClass, helperConstant } from './helper';
import utils from './utils';
import { add, multiply } from './utils';

interface ExtensionContext {
  extensionId: string;
  extensionPath: string;
  version: string;
}

interface ExtensionActivation {
  services?: {
    [key: string]: any;
  };
  dispose?: () => void;
}

export function activate(context: ExtensionContext): ExtensionActivation {
  console.log('[test-multi-file] Activating extension...');
  console.log('[test-multi-file] Context:', context);
  
  // helper.tsの関数を使用
  const helperResult = helperFunction();
  console.log('[test-multi-file] Helper function result:', helperResult);
  
  // helper.tsのクラスを使用
  const helperInstance = new HelperClass('Test message');
  console.log('[test-multi-file] Helper class result:', helperInstance.getMessage());
  
  // helper.tsの定数を使用
  console.log('[test-multi-file] Helper constant:', helperConstant);
  
  // utils.tsのdefault exportを使用
  console.log('[test-multi-file] Utils version:', utils.version);
  
  // utils.tsの名前付きexportを使用
  const sum = add(5, 3);
  const product = multiply(5, 3);
  console.log('[test-multi-file] Math results:', { sum, product });
  
  // utils経由でも使用
  const sum2 = utils.add(10, 20);
  console.log('[test-multi-file] Utils.add result:', sum2);

  return {
    services: {
      'test-service': {
        helperFunction,
        HelperClass,
        helperConstant,
        utils,
        add,
        multiply,
        testAll: () => {
          return {
            helperResult,
            helperMessage: helperInstance.getMessage(),
            helperConstant,
            utilsVersion: utils.version,
            mathResults: { sum, product, sum2 }
          };
        }
      }
    },
    dispose: () => {
      console.log('[test-multi-file] Disposing extension...');
    }
  };
}

export function deactivate(): void {
  console.log('[test-multi-file] Deactivating extension...');
}
