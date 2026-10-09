declare module 'assert/' {
  import nodeAssert = require('node:assert');

  type AssertMethods = Pick<
    typeof nodeAssert,
    | 'deepEqual'
    | 'deepStrictEqual'
    | 'doesNotMatch'
    | 'doesNotReject'
    | 'doesNotThrow'
    | 'equal'
    | 'fail'
    | 'ifError'
    | 'match'
    | 'notDeepEqual'
    | 'notDeepStrictEqual'
    | 'notEqual'
    | 'notStrictEqual'
    | 'ok'
    | 'rejects'
    | 'strictEqual'
    | 'throws'
  >;

  type StrictAssertMethods = Pick<
    typeof nodeAssert.strict,
    | 'deepEqual'
    | 'deepStrictEqual'
    | 'doesNotMatch'
    | 'doesNotReject'
    | 'doesNotThrow'
    | 'equal'
    | 'fail'
    | 'ifError'
    | 'match'
    | 'notDeepEqual'
    | 'notDeepStrictEqual'
    | 'notEqual'
    | 'notStrictEqual'
    | 'ok'
    | 'rejects'
    | 'strictEqual'
    | 'throws'
  >;

  interface StrictAssert extends StrictAssertMethods {
    (value: unknown, message?: string | Error): asserts value;
    readonly AssertionError: typeof nodeAssert.AssertionError;
    readonly strict: StrictAssert;
  }

  interface Assert extends AssertMethods {
    (value: unknown, message?: string | Error): asserts value;
    readonly AssertionError: typeof nodeAssert.AssertionError;
    readonly strict: StrictAssert;
  }

  const assert: Assert;
  export = assert;
}
