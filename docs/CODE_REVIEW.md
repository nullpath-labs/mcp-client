# x402 Payment Implementation - Code Review

**Reviewer:** voltagent-qa-sec-code-reviewer  
**Date:** 2026-02-10  
**Status:** Review Complete - Issues Found

---

## Summary

The implementation correctly adds EIP-3009 payment signing to the MCP client. The core cryptographic flow is correct, and security practices around private key handling are solid. However, there are several edge cases and one incomplete implementation that should be addressed.

| File | Status | Critical | Medium | Low |
|------|--------|----------|--------|-----|
| eip3009.ts | ✅ Good | 0 | 1 | 0 |
| wallet.ts | ✅ Excellent | 0 | 0 | 0 |
| payment.ts | ⚠️ Needs Work | 0 | 3 | 1 |
| index.ts | ⚠️ Needs Work | 1 | 1 | 0 |

---

## Security Analysis ✅

### Private Key Handling
- ✅ Private key read from environment only, never logged
- ✅ No `console.log` statements that could leak secrets
- ✅ Wallet created fresh per payment (no persistent storage)
- ✅ Uses `crypto.getRandomValues()` for secure nonce generation

### Network Security
- ✅ HTTPS by default for API calls
- ✅ Base64 encoding for headers (no raw secrets in transit)

---

## File-by-File Review

### `src/lib/eip3009.ts`

**Overall:** Well-structured, correct EIP-712 implementation.

#### ✅ Correct
- USDC address: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` ✓
- EIP-712 domain: `{ name: "USD Coin", version: "2", chainId: 8453 }` ✓
- TransferWithAuthorization types match spec ✓
- Validates `from` address matches wallet ✓

#### ⚠️ Medium: Signature parsing assumes 65-byte format

**File:** `src/lib/eip3009.ts:119-121`

```typescript
const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
const v = parseInt(signature.slice(130, 132), 16);
```

**Issue:** Assumes signature is exactly 132 characters (65 bytes). While viem typically returns standard signatures, EIP-2098 compact signatures (64 bytes) would fail silently.

**Suggested Fix:**
```typescript
// Validate signature length
if (signature.length !== 132) {
  throw new Error(`Unexpected signature length: ${signature.length}, expected 132`);
}
const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
const v = parseInt(signature.slice(130, 132), 16);
```

---

### `src/lib/wallet.ts`

**Overall:** Excellent implementation. No issues found.

#### ✅ Highlights
- Proper hex validation with regex
- Handles with/without `0x` prefix
- Clear error classes (`WalletNotConfiguredError`, `InvalidPrivateKeyError`)
- Helper functions for checking config without creating full wallet

---

### `src/lib/payment.ts`

**Overall:** Core logic is correct, but edge cases need attention.

#### ⚠️ Medium: String/number coercion for validAfter/validBefore

**File:** `src/lib/payment.ts:116-117`

```typescript
const validAfter = BigInt(data.validAfter ?? 0);
const validBefore = BigInt(data.validBefore ?? now + 300);
```

**Issue:** If server sends `validAfter: "0"` as a string, the nullish coalescing (`??`) won't trigger because `"0"` is truthy, but `BigInt("0")` works. However, edge cases like empty string `""` would throw.

**Suggested Fix:**
```typescript
const validAfter = BigInt(data.validAfter || 0);
const validBefore = BigInt(data.validBefore || now + 300);
```

---

#### ⚠️ Medium: No validation that validBefore is in the future

**File:** `src/lib/payment.ts:116-117`

**Issue:** If server returns a `validBefore` timestamp that's already passed, the payment will be signed but rejected on-chain, wasting a signature.

**Suggested Fix:**
```typescript
const now = Math.floor(Date.now() / 1000);
const validBefore = BigInt(data.validBefore || now + 300);

// Ensure authorization window is still valid
if (validBefore <= BigInt(now)) {
  throw new PaymentRequiredError(
    `Payment authorization expired: validBefore ${validBefore} is in the past`
  );
}
```

---

#### ⚠️ Medium: Retry response error handling incomplete

**File:** `src/lib/payment.ts:187-195`

```typescript
// If still 402, payment was rejected
if (retryResponse.status === 402) {
  throw new PaymentRequiredError(
    'Payment was rejected by the server',
    requirements
  );
}

return retryResponse;
```

**Issue:** Only checks for 402 on retry. Other error codes (500, 403, etc.) pass through without error context. Also doesn't include response body which may have useful error info.

**Suggested Fix:**
```typescript
if (retryResponse.status === 402) {
  const errorBody = await retryResponse.text().catch(() => '');
  throw new PaymentRequiredError(
    `Payment was rejected by the server: ${errorBody || 'no details'}`,
    requirements
  );
}

if (!retryResponse.ok) {
  const errorBody = await retryResponse.text().catch(() => '');
  throw new Error(`Payment submitted but request failed (${retryResponse.status}): ${errorBody}`);
}

return retryResponse;
```

---

#### 💡 Low: Legacy header check is case-sensitive

**File:** `src/lib/payment.ts:82-87`

```typescript
const header = response.headers.get('X-PAYMENT-REQUIRED');
if (!header) {
  // Try legacy header name
  const legacyHeader = response.headers.get('X-Payment-Required');
```

**Issue:** HTTP headers are case-insensitive by spec. The `Headers.get()` method should handle this automatically, making the legacy check redundant. Consider removing for clarity.

---

### `src/index.ts`

**Overall:** Good integration, but one incomplete implementation and an edge case.

#### 🔴 Critical: `handleRegisterAgent` incomplete

**File:** `src/index.ts:193-204`

```typescript
async function handleRegisterAgent(args: {...}) {
  const walletKey = process.env.NULLPATH_WALLET_KEY;
  
  if (!walletKey) {
    return { error: '...' };
  }
  
  // TODO: Implement full x402 payment flow
  return apiCall('/agents', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}
```

**Issue:** Registration requires payment but uses `apiCall` instead of `fetchWithPayment`. Will fail with 402 in production or bypass payment entirely if server doesn't enforce.

**Suggested Fix:**
```typescript
async function handleRegisterAgent(args: {...}) {
  if (!isWalletConfigured()) {
    return {
      error: 'Wallet not configured',
      message: 'Set NULLPATH_WALLET_KEY environment variable with your private key.',
      info: 'Registration costs $0.10 USDC.',
    };
  }

  const url = `${NULLPATH_API_URL}/agents`;
  
  try {
    const response = await fetchWithPayment(url, {
      method: 'POST',
      body: JSON.stringify(args),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error (${response.status}): ${error}`);
    }
    
    const result = await response.json();
    const walletAddress = getWalletAddress();
    return {
      ...result,
      _payment: {
        status: 'paid',
        from: walletAddress,
      },
    };
  } catch (error) {
    // Same error handling as handleExecuteAgent
    if (error instanceof WalletNotConfiguredError) { ... }
    if (error instanceof PaymentRequiredError) { ... }
    if (error instanceof PaymentSigningError) { ... }
    throw error;
  }
}
```

---

#### ⚠️ Medium: `getWalletAddress()` can return null

**File:** `src/index.ts:168-172`

```typescript
const walletAddress = getWalletAddress();
return {
  ...result,
  _payment: {
    status: 'paid',
    from: walletAddress,  // Could be null
  },
};
```

**Issue:** If `NULLPATH_WALLET_KEY` is set but malformed, `isWalletConfigured()` returns true but `getWalletAddress()` returns null. The payment would still go through (createWallet would throw), but this inconsistency is confusing.

**Suggested Fix:**
```typescript
const walletAddress = getWalletAddress();
return {
  ...result,
  _payment: {
    status: 'paid',
    from: walletAddress ?? 'unknown',
  },
};
```

Or better, validate wallet at the start:
```typescript
try {
  const wallet = createWallet();
  // Use wallet.address instead of getWalletAddress()
} catch (e) {
  if (e instanceof InvalidPrivateKeyError) {
    return { error: 'Invalid wallet key', message: e.message };
  }
}
```

---

## Types Review ✅

- All functions have proper TypeScript types
- Branded types (`0x${string}`) used correctly for addresses
- Interfaces properly define all payment structures
- Error classes extend Error with typed properties

---

## Edge Cases to Test

1. **Network timeout during payment retry** - No explicit timeout handling
2. **Server returns 402 with missing X-PAYMENT-REQUIRED header** - Handled ✓
3. **Malformed base64 in payment header** - Handled with try/catch ✓
4. **BigInt overflow for very large amounts** - Possible but unlikely for USDC
5. **Concurrent payment requests** - Each generates unique nonce ✓

---

## Recommendations

### Before Merge
1. Fix `handleRegisterAgent` to use `fetchWithPayment` (Critical)
2. Add signature length validation in `eip3009.ts`
3. Add `validBefore` future check in `payment.ts`
4. Handle non-402 errors on retry in `payment.ts`

### Nice to Have
- Add request timeout option to `fetchWithPayment`
- Add retry count to error messages for debugging
- Consider adding telemetry for payment success/failure rates

---

## Test Coverage Needed

```typescript
// Suggested test cases for payment.test.ts
describe('parsePaymentRequired', () => {
  it('parses valid 402 response')
  it('returns null for non-402')
  it('throws on missing header')
  it('handles string amounts')
  it('rejects expired validBefore')
});

describe('fetchWithPayment', () => {
  it('passes through non-402 responses')
  it('signs and retries on 402')
  it('throws WalletNotConfiguredError when no key')
  it('throws PaymentRequiredError on second 402')
  it('handles network errors gracefully')
});
```

---

*Review completed. Overall the implementation is solid with correct cryptographic primitives. Address the critical issue in `handleRegisterAgent` before merge.*
