export type MeteredSearchOutcome<Value> =
  | { kind: 'billable_success'; value: Value }
  | { kind: 'refund'; reason: string; value: Value };

export interface UsageAccountingReservation {
  allowed: boolean;
  reservationId: string | null;
}

export interface UsageAccountingDependencies<AuthContext, Value> {
  authenticate: () => Promise<AuthContext>;
  reserve: (auth: AuthContext) => Promise<UsageAccountingReservation>;
  search: (
    auth: AuthContext,
    reservation: UsageAccountingReservation,
  ) => Promise<MeteredSearchOutcome<Value>>;
  commit: (auth: AuthContext, reservationId: string) => Promise<void>;
  refund: (
    auth: AuthContext,
    reservationId: string,
    reason: string,
  ) => Promise<void>;
}

export type UsageAccountingControllerResult<AuthContext, Value> =
  | {
      kind: 'not_allowed';
      auth: AuthContext;
      reservation: UsageAccountingReservation;
    }
  | {
      kind: 'billable_success' | 'refunded';
      auth: AuthContext;
      reservation: UsageAccountingReservation;
      value: Value;
    };

export type UsageAccountingFailureStage =
  | 'authenticate'
  | 'reserve'
  | 'search'
  | 'commit';

export class UsageAccountingControllerError extends Error {
  readonly stage: UsageAccountingFailureStage;
  readonly cause: unknown;
  readonly refundError: unknown;

  constructor(
    stage: UsageAccountingFailureStage,
    cause: unknown,
    refundError: unknown = null,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'UsageAccountingControllerError';
    this.stage = stage;
    this.cause = cause;
    this.refundError = refundError;
  }
}

export async function runUsageAccountingController<AuthContext, Value>(
  dependencies: UsageAccountingDependencies<AuthContext, Value>,
): Promise<UsageAccountingControllerResult<AuthContext, Value>> {
  let auth: AuthContext;
  try {
    auth = await dependencies.authenticate();
  } catch (error) {
    throw new UsageAccountingControllerError('authenticate', error);
  }

  let reservation: UsageAccountingReservation;
  try {
    reservation = await dependencies.reserve(auth);
  } catch (error) {
    throw new UsageAccountingControllerError('reserve', error);
  }

  if (!reservation.allowed) {
    return { kind: 'not_allowed', auth, reservation };
  }

  let refunded = false;
  const refundOnce = async (reason: string): Promise<unknown> => {
    if (refunded || !reservation.reservationId) return null;
    refunded = true;
    try {
      await dependencies.refund(auth, reservation.reservationId, reason);
      return null;
    } catch (error) {
      return error;
    }
  };

  let searchOutcome: MeteredSearchOutcome<Value>;
  try {
    searchOutcome = await dependencies.search(auth, reservation);
  } catch (error) {
    const refundError = await refundOnce('replacement_price_search_error');
    throw new UsageAccountingControllerError('search', error, refundError);
  }

  if (searchOutcome.kind === 'refund') {
    const refundError = await refundOnce(searchOutcome.reason);
    if (refundError) {
      throw new UsageAccountingControllerError(
        'search',
        new Error('Usage refund failed.'),
        refundError,
      );
    }
    return {
      kind: 'refunded',
      auth,
      reservation,
      value: searchOutcome.value,
    };
  }

  if (reservation.reservationId) {
    try {
      await dependencies.commit(auth, reservation.reservationId);
    } catch (error) {
      const refundError = await refundOnce('usage_commit_failed');
      throw new UsageAccountingControllerError('commit', error, refundError);
    }
  }

  return {
    kind: 'billable_success',
    auth,
    reservation,
    value: searchOutcome.value,
  };
}
