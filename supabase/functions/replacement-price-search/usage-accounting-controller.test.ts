import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runUsageAccountingController,
  UsageAccountingControllerError,
  type MeteredSearchOutcome,
} from './usage-accounting-controller.ts';
import { filterResultsToPriceRange } from './query-model.ts';

type Scenario = {
  allowed?: boolean;
  reservationFailure?: Error;
  searchFailure?: Error;
  searchOutcome?: MeteredSearchOutcome<string>;
  commitFailure?: Error;
};

function scenario(input: Scenario = {}) {
  const calls = {
    authenticate: 0,
    reserve: 0,
    search: 0,
    commit: 0,
    refund: [] as string[],
  };
  const dependencies = {
    authenticate: async () => {
      calls.authenticate += 1;
      return { userId: 'user-1' };
    },
    reserve: async () => {
      calls.reserve += 1;
      if (input.reservationFailure) throw input.reservationFailure;
      return {
        allowed: input.allowed ?? true,
        reservationId: 'reservation-1',
      };
    },
    search: async () => {
      calls.search += 1;
      if (input.searchFailure) throw input.searchFailure;
      return (
        input.searchOutcome ?? {
          kind: 'billable_success' as const,
          value: 'response',
        }
      );
    },
    commit: async () => {
      calls.commit += 1;
      if (input.commitFailure) throw input.commitFailure;
    },
    refund: async (_auth: unknown, _reservationId: string, reason: string) => {
      calls.refund.push(reason);
    },
  };
  return { calls, dependencies };
}

test('successful search reserves once, commits once, and does not refund', async () => {
  const { calls, dependencies } = scenario();
  const result = await runUsageAccountingController(dependencies);
  assert.equal(result.kind, 'billable_success');
  assert.deepEqual(calls, {
    authenticate: 1,
    reserve: 1,
    search: 1,
    commit: 1,
    refund: [],
  });
});

for (const [name, reason] of [
  ['zero usable results', 'no_usable_priced_results'],
  ['provider failure', 'serper_provider_failure'],
  ['provider timeout', 'serper_timeout'],
] as const) {
  test(`${name} reserves once, refunds once, and does not commit`, async () => {
    const { calls, dependencies } = scenario({
      searchOutcome: { kind: 'refund', reason, value: 'response' },
    });
    const result = await runUsageAccountingController(dependencies);
    assert.equal(result.kind, 'refunded');
    assert.equal(calls.reserve, 1);
    assert.equal(calls.search, 1);
    assert.equal(calls.commit, 0);
    assert.deepEqual(calls.refund, [reason]);
  });
}

test('provider results outside a refined range refund instead of committing', async () => {
  const { calls, dependencies } = scenario();
  dependencies.search = async () => {
    calls.search += 1;
    const returned = [{ price: 80 }, { price: 449 }, { price: 649 }];
    const inRange = filterResultsToPriceRange(returned, 200, 400);
    return inRange.some((result) => result.price != null)
      ? { kind: 'billable_success' as const, value: 'response' }
      : {
          kind: 'refund' as const,
          reason: 'no_usable_priced_results',
          value: 'response',
        };
  };

  const result = await runUsageAccountingController(dependencies);
  assert.equal(result.kind, 'refunded');
  assert.equal(calls.reserve, 1);
  assert.equal(calls.search, 1);
  assert.equal(calls.commit, 0);
  assert.deepEqual(calls.refund, ['no_usable_priced_results']);
});

test('an exception after reservation refunds exactly once and never commits', async () => {
  const { calls, dependencies } = scenario({
    searchFailure: new Error('normalisation failed'),
  });
  await assert.rejects(
    runUsageAccountingController(dependencies),
    (error: unknown) =>
      error instanceof UsageAccountingControllerError &&
      error.stage === 'search',
  );
  assert.equal(calls.commit, 0);
  assert.deepEqual(calls.refund, ['replacement_price_search_error']);
});

test('reservation failure never searches, commits, or refunds', async () => {
  const { calls, dependencies } = scenario({
    reservationFailure: new Error('reserve failed'),
  });
  await assert.rejects(
    runUsageAccountingController(dependencies),
    (error: unknown) =>
      error instanceof UsageAccountingControllerError &&
      error.stage === 'reserve',
  );
  assert.equal(calls.search, 0);
  assert.equal(calls.commit, 0);
  assert.deepEqual(calls.refund, []);
});

test('authentication failure stops before reservation or provider work', async () => {
  const { calls, dependencies } = scenario();
  dependencies.authenticate = async () => {
    calls.authenticate += 1;
    throw new Error('unauthorised');
  };
  await assert.rejects(
    runUsageAccountingController(dependencies),
    (error: unknown) =>
      error instanceof UsageAccountingControllerError &&
      error.stage === 'authenticate',
  );
  assert.equal(calls.reserve, 0);
  assert.equal(calls.search, 0);
  assert.equal(calls.commit, 0);
  assert.deepEqual(calls.refund, []);
});

test('a denied reservation never calls the provider and is not refunded', async () => {
  const { calls, dependencies } = scenario({ allowed: false });
  const result = await runUsageAccountingController(dependencies);
  assert.equal(result.kind, 'not_allowed');
  assert.equal(calls.search, 0);
  assert.equal(calls.commit, 0);
  assert.deepEqual(calls.refund, []);
});

test('commit failure follows the current refund-on-failure policy without a retry', async () => {
  const { calls, dependencies } = scenario({
    commitFailure: new Error('commit failed'),
  });
  await assert.rejects(
    runUsageAccountingController(dependencies),
    (error: unknown) =>
      error instanceof UsageAccountingControllerError &&
      error.stage === 'commit',
  );
  assert.equal(calls.reserve, 1);
  assert.equal(calls.search, 1);
  assert.equal(calls.commit, 1);
  assert.deepEqual(calls.refund, ['usage_commit_failed']);
});
