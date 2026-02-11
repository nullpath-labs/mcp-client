# x402 Payment Signing for MCP Client

## Goal
Add automatic EIP-3009 payment signing to the nullpath MCP client so users can execute paid tools (execute_agent, register_agent) without manual payment handling.

## Current State
- MCP client at `/Users/tg_air/playground/mcp-client`
- Free tools work: discover_agents, lookup_agent, get_capabilities, check_reputation
- Paid tools exist on server but client can't sign payments
- `viem` already installed as dependency

## User Flow (Target)
1. User configures `NULLPATH_WALLET_KEY` in Claude Desktop config
2. User asks Claude: "Execute the URL Summarizer on https://example.com"
3. Client calls execute_agent tool
4. Server returns 402 Payment Required with:
   - `X-PAYMENT-REQUIRED`: payment requirements (recipient, amount, asset, network)
5. Client parses 402, signs EIP-3009 TransferWithAuthorization
6. Client retries with `X-PAYMENT` header containing signature
7. Server verifies, executes agent, returns result
8. User sees result seamlessly

## Technical Requirements

### 1. Wallet Configuration
- Read `NULLPATH_WALLET_KEY` from environment
- Create viem wallet client for signing
- Support Base mainnet (chainId: 8453)

### 2. Payment Detection
- Detect 402 status code
- Parse `X-PAYMENT-REQUIRED` header (base64 JSON)
- Extract: recipient, amount, asset (USDC address), network, validAfter, validBefore

### 3. EIP-3009 Signing
- Sign `TransferWithAuthorization` for USDC
- Parameters: from, to, value, validAfter, validBefore, nonce
- Use viem's signTypedData

### 4. Payment Header
- Encode signature as `X-PAYMENT` header
- Format: base64 JSON with { signature, from, to, value, validAfter, validBefore, nonce }

### 5. Retry Logic
- On 402, sign and retry automatically
- Max 1 retry (don't loop)
- Return clear error if payment fails

## Files to Create/Modify

### New Files
- `src/lib/wallet.ts` - Wallet client setup
- `src/lib/payment.ts` - Payment signing logic
- `src/lib/eip3009.ts` - EIP-3009 typed data structure
- `src/__tests__/payment.test.ts` - Payment tests

### Modify
- `src/index.ts` - Add payment handling to execute_agent and register_agent tools
- `README.md` - Document wallet configuration

## USDC Contract Info
- Base Mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- EIP-3009 domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: <address> }

## Reference
- x402 spec: https://github.com/coinbase/x402
- Server payment middleware: nullpath repo `packages/mcp/src/middleware/payment.ts`
- Existing x402 lib: nullpath repo `packages/mcp/src/lib/x402.ts`

## Success Criteria
- [ ] User can execute paid tools with just NULLPATH_WALLET_KEY env var
- [ ] Payment signing is automatic and transparent
- [ ] Clear error messages if wallet not configured or payment fails
- [ ] Tests pass
- [ ] Works in Claude Desktop
