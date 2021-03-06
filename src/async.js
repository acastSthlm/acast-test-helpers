/*
 Acast Test Helpers
 Copyright (C) 2017 Acast AB

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.

 For more information about this program, or to contact the authors,
 see https://github.com/acastSthlm/acast-test-helpers
 */
let testPromise = null;
let isInsideAsyncIt = false;
let currentErrorMessage = null;

const POLL_INTERVAL_MILLISECONDS = 100;

/**
 * Sets up the async test tools by adding the appropriate calls to `beforeEach` and `afterEach`.
 * Call once in the top of a `describe` that you wish to use the async tools in.
 * NOTE: When using {@link setupAndTeardownApp}, it is not necessary to call this function separately.
 */
export function setupAsync() {
  let timeoutHandle = null;

  beforeEach('create test promise', function() {
    if (testPromise) {
      return;
    }

    testPromise = Promise.resolve();
    currentErrorMessage = null;

    const timeout = this.currentTest.timeout();
    this.currentTest.timeout(0); // disable built-in timeout;
    setCustomTimeout(timeout);
    this.currentTest.timeout = setCustomTimeout;
  });

  afterEach('remove test promise', () => {
    testPromise = null;
    clearTimeout(timeoutHandle);
  });

  function setCustomTimeout(timeoutMillis) {
    if (!timeoutMillis) {
      return;
    }
    clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      throw new Error(getErrorMessage());
    }, timeoutMillis);
  }
}

/**
 * Drop-in replacement for the regular `it` function, with the same signature.
 * This will augments the `it` functionality to automatically return the global test promise behind the scenes, to make
 * the asynchronous helpers work as expected without any need for the developer to return a promise or call a `done` function.
 * The `done` parameter can still be used and will override the global test promise flow as per the default mocha behavior.
 *
 * @NOTE: None of the async helpers can be used outside a function passed to `asyncIt`.
 */
export const asyncIt = createAsyncIt(it);
asyncIt.only = createAsyncIt(it.only);
asyncIt.skip = createAsyncIt(it.skip);

function createAsyncIt(regularItFunction) {
  return (description, func) => {
    if (!func) {
      regularItFunction(description);
    } else {
      regularItFunction(description, wrapForAsyncIt(func));
    }
  };
}

function wrapForAsyncIt(func) {
  function wrappedBody(done) {
    isInsideAsyncIt = true;
    const funcResult = func.call(this, done);
    isInsideAsyncIt = false;

    if (isPromise(funcResult)) {
      testPromise = testPromise.then(() => {
        currentErrorMessage = 'Promise returned from `asyncIt` never resolved.';
        return funcResult;
      });
    }

    return testPromise;
  }

  const funcTakesDoneAsParameter = func.length === 1;
  const wrapperFunc = funcTakesDoneAsParameter
    ? function(done) {
        return wrappedBody.call(this, done);
      }
    : function() {
        return wrappedBody.call(this);
      };

  wrapperFunc.toString = () => func.toString();

  return wrapperFunc;
}

function isPromise(maybePromise) {
  return (
    maybePromise && maybePromise.then && typeof maybePromise.then === 'function'
  );
}

function getErrorMessage() {
  const defaultErrorMessage =
    'acast-test-helpers#asyncIt(): Timed out - `done` callback was never called.';
  const errorMessage = typeof currentErrorMessage === 'function'
    ? currentErrorMessage()
    : currentErrorMessage;
  return errorMessage || defaultErrorMessage;
}

/**
 * Triggers a callback after the previous asynchronous tool function resolves.
 * @param {function} doThis The callback function to call when the previous asynchronous tool function resolves. This
 * function will receive as argument the resolved result of that previous asynchronous tool function.
 * @example
 * waitUntilExists('.some-element');
 * andThen(someElementAsJqueryObject => {
 *   // someElementAsJqueryObject is the result of matching '.some-element'.
 * });
 *
 */
export function andThen(
  doThis,
  errorMessage = 'acast-test-helpers#andThen(): Returned promise never resolved.'
) {
  if (!testPromise) {
    throw new Error(
      'acast-test-helpers#andThen(): You cannot use the async functions unless you call setupAsync() at the root of the appropriate describe()!'
    );
  }

  if (!isInsideAsyncIt) {
    throw new Error(
      'acast-test-helpers#andThen(): You can only use the async functions from acast-test-helpers inside asyncIt. Also note that you cannot nest calls to async functions.'
    );
  }
  testPromise = testPromise.then(chainedValue => {
    currentErrorMessage = errorMessage;
    return doThis(chainedValue);
  });
}

function resolveWhenPredicateReturnsTruthy(predicate, resolve, chainedValue) {
  let returnValue;
  try {
    returnValue = predicate(chainedValue);
  } catch (e) {
    currentErrorMessage = `acast-test-helpers#waitUntil() timed out. This is the last exception that was caught: ${e.message}`;
    returnValue = false;
  }
  if (!!returnValue) {
    resolve(returnValue);
  } else {
    const oldTestPromise = testPromise;
    setTimeout(() => {
      let isStillInSameTest = oldTestPromise === testPromise;
      if (isStillInSameTest) {
        resolveWhenPredicateReturnsTruthy(predicate, resolve, chainedValue);
      }
    }, POLL_INTERVAL_MILLISECONDS);
  }
}

/**
 * Waits until a callback returns any truthy value. It waits by polling the function repeatedly.
 * This is very useful for verifying test results, among other things.
 * @param {function} thisReturnsTruthy The function to poll.
 * @param {string|function} errorMessage The string, or function returning a string, to be shown if this times out.
 *
 * @example
 * waitUntil(() => expect(foobar).to.equal(3)); // This will either pass as the expectation holds and is returned as truthy, or keep polling.
 * @example
 * waitUntil(() => 3);
 * andThen(value => {
 *   // value = 3
 * });
 */
export function waitUntil(
  thisReturnsTruthy,
  errorMessage = `acast-test-helpers#waitUntil() timed out since the following function never returned a truthy value within the timeout: ${thisReturnsTruthy}`
) {
  andThen(
    chainedValue =>
      new Promise(resolve => {
        resolveWhenPredicateReturnsTruthy(
          thisReturnsTruthy,
          resolve,
          chainedValue
        );
      }),
    errorMessage
  );
}

/**
 * Waits a specific number of milliseconds.
 * NOTE: Using this method is highly discouraged for anything other than temporary
 * experiments. The reason is that it leads to either very long running or non-deterministic tests,
 * none of which is desirable.
 * @param {number} milliseconds The number of milliseconds to wait.
 */
export function waitMillis(milliseconds) {
  andThen(
    () =>
      new Promise(resolve => {
        setTimeout(resolve, milliseconds);
      }),
    `acast-test-helpers#waitMillis() timed out while waiting ${milliseconds} milliseconds`
  );
}

/**
 * Waits until a function gives a different return value from one call to the next.
 * @param {function} predicate The function to be polled.
 * @param {string|function} errorMessage The string, or function returning a string, to be shown if this times out.
 * @example
 * let foo = 'something';
 * waitUntilChange(() => foo);
 * andThen(theNewValueOfFoo => {
 *   console.log(theNewValueOfFoo); // 'something else'
 * });
 * setTimeout(() => {
 *   foo = 'something else';
 * }, 1000);
 */
export function waitUntilChange(
  predicate,
  errorMessage = `acast-test-helpers#waitUntilChange() timed out since the return value of the following function never changed: ${predicate}`
) {
  let initialValue;
  let newValue;

  andThen(chainedValue => {
    initialValue = predicate(chainedValue);
    return chainedValue;
  });

  waitUntil(chainedValue => {
    newValue = predicate(chainedValue);
    return newValue !== initialValue;
  }, errorMessage);

  andThen(() => newValue);
}
