import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearApprovalCache,
  createRequireApprovedUser,
  optionalVerifiedUser
} from './auth.js';

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

function createFakeDb(docs: Record<string, Record<string, unknown> | null>) {
  return {
    collection(colName: string) {
      return {
        doc(docId: string) {
          return {
            async get() {
              const key = `${colName}/${docId}`;
              const data = docs[key];
              return {
                exists: data != null,
                data: () => data ?? undefined
              };
            }
          };
        }
      };
    }
  } as any;
}

describe('auth middleware and helpers', () => {
  beforeEach(() => {
    clearApprovalCache();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const middleware = createRequireApprovedUser({
      verifyIdToken: async () => ({ uid: 'u1' }),
      isConfigured: () => true,
      getFirestore: () => createFakeDb({})
    });

    const req: any = { headers: {} };
    const res = createMockResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Authentication required' });
  });

  it('returns 401 when token verification fails', async () => {
    const middleware = createRequireApprovedUser({
      verifyIdToken: async () => {
        throw new Error('expired');
      },
      isConfigured: () => true,
      getFirestore: () => createFakeDb({})
    });

    const req: any = { headers: { authorization: 'Bearer bad-token' } };
    const res = createMockResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Invalid or expired token' });
  });

  it('returns 403 when user is not approved (and fails closed on Firestore errors)', async () => {
    const middleware = createRequireApprovedUser({
      verifyIdToken: async () => ({ uid: 'u-pending', email: 'pending@example.com' }),
      isConfigured: () => true,
      getFirestore: () => createFakeDb({ 'users/u-pending': { approved: false } })
    });

    const req: any = { headers: { authorization: 'Bearer valid-token' } };
    const res = createMockResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Account pending approval' });

    // Firestore error fails closed
    const failingMiddleware = createRequireApprovedUser({
      verifyIdToken: async () => ({ uid: 'u-err', email: 'err@example.com' }),
      isConfigured: () => true,
      getFirestore: () => ({
        collection() {
          throw new Error('firestore unavailable');
        }
      }) as any
    });

    const res2 = createMockResponse();
    await failingMiddleware({ headers: { authorization: 'Bearer valid-token' } } as any, res2, () => {});
    assert.equal(res2.statusCode, 403);
  });

  it('approves via users/{uid}.approved, admins/{uid}, or config/admins.emails and caches positive approval', async () => {
    let firestoreCalls = 0;
    const db = {
      collection(colName: string) {
        firestoreCalls++;
        return createFakeDb({
          'users/u-approved': { approved: true },
          'admins/u-admin': { role: 'admin' },
          'config/admins': { emails: ['AdminUser@Example.COM'] }
        }).collection(colName);
      }
    } as any;

    // 1. users/{uid}.approved === true
    const m1 = createRequireApprovedUser({
      verifyIdToken: async () => ({ uid: 'u-approved', email: 'user@example.com' }),
      isConfigured: () => true,
      getFirestore: () => db
    });

    const req1: any = { headers: { authorization: 'Bearer tok' } };
    const res1 = createMockResponse();
    let nextCount = 0;
    await m1(req1, res1, () => nextCount++);
    assert.equal(nextCount, 1);
    assert.deepEqual(req1.user, { uid: 'u-approved', email: 'user@example.com' });
    const callsAfterFirst = firestoreCalls;

    // Second call uses positive cache
    await m1({ headers: { authorization: 'Bearer tok' } } as any, createMockResponse(), () => nextCount++);
    assert.equal(nextCount, 2);
    assert.equal(firestoreCalls, callsAfterFirst);

    // 2. admins/{uid}
    const m2 = createRequireApprovedUser({
      verifyIdToken: async () => ({ uid: 'u-admin', email: 'other@example.com' }),
      isConfigured: () => true,
      getFirestore: () => db
    });
    const req2: any = { headers: { authorization: 'Bearer tok' } };
    await m2(req2, createMockResponse(), () => nextCount++);
    assert.equal(nextCount, 3);

    // 3. config/admins.emails (case-insensitive)
    const m3 = createRequireApprovedUser({
      verifyIdToken: async () => ({ uid: 'u-config-admin', email: 'adminuser@example.com' }),
      isConfigured: () => true,
      getFirestore: () => db
    });
    const req3: any = { headers: { authorization: 'Bearer tok' } };
    await m3(req3, createMockResponse(), () => nextCount++);
    assert.equal(nextCount, 4);
  });

  it('optionalVerifiedUser returns user on valid token and null when missing/invalid', async () => {
    const deps = {
      isConfigured: () => true,
      verifyIdToken: async (token: string) => {
        if (token === 'good') return { uid: 'uid-1', email: 'user@example.com' };
        throw new Error('invalid');
      }
    };

    assert.equal(await optionalVerifiedUser({ headers: {} }, deps), null);
    assert.equal(await optionalVerifiedUser({ headers: { authorization: 'Bearer bad' } }, deps), null);
    assert.deepEqual(
      await optionalVerifiedUser({ headers: { authorization: 'Bearer good' } }, deps),
      { uid: 'uid-1', email: 'user@example.com' }
    );
  });
});
