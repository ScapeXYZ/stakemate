import { ProviderError } from "./errors";
import * as grpc from "@grpc/grpc-js";
import { GrpcTypes } from "@mysten/sui/grpc";

export type TatumSuiNetwork = "mainnet" | "testnet" | "devnet";

const endpoints: Record<TatumSuiNetwork, string> = {
  mainnet: "https://sui-mainnet.gateway.tatum.io",
  testnet: "https://sui-testnet.gateway.tatum.io",
  devnet: "https://sui-devnet.gateway.tatum.io",
};
const grpcEndpoints: Record<TatumSuiNetwork, string> = {
  mainnet: "sui-mainnet-grpc.gateway.tatum.io:443",
  testnet: "sui-testnet-grpc.gateway.tatum.io:443",
  devnet: "sui-devnet-grpc.gateway.tatum.io:443",
};
type GrpcMessage = { toBinary(value: unknown): Uint8Array; fromBinary(value: Uint8Array): unknown };

// Use the package's public registry instead of resolving an internal protobuf
// file at runtime. The static package import lets Turbopack include these
// generated definitions in the Vercel function bundle.
const ledgerMessages: Record<"GetServiceInfoRequest" | "GetServiceInfoResponse" | "GetObjectRequest" | "GetObjectResponse" | "GetTransactionRequest" | "GetTransactionResponse", GrpcMessage> = {
  GetServiceInfoRequest: GrpcTypes.GetServiceInfoRequest,
  GetServiceInfoResponse: GrpcTypes.GetServiceInfoResponse,
  GetObjectRequest: GrpcTypes.GetObjectRequest,
  GetObjectResponse: GrpcTypes.GetObjectResponse,
  GetTransactionRequest: GrpcTypes.GetTransactionRequest,
  GetTransactionResponse: GrpcTypes.GetTransactionResponse,
};
const stateMessages: Record<"GetBalanceRequest" | "GetBalanceResponse", GrpcMessage> = {
  GetBalanceRequest: GrpcTypes.GetBalanceRequest,
  GetBalanceResponse: GrpcTypes.GetBalanceResponse,
};

export type TatumSuiClientOptions = {
  apiKey?: string;
  network?: TatumSuiNetwork;
  /** Retained only for legacy callers; supported reads use native gRPC. */
  endpoint?: string;
  /** Native gRPC authority, without an HTTP path. Server-side only. */
  grpcEndpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type TatumSuiHealth = { ok: true; network: TatumSuiNetwork; chainIdentifier: string };
export type TatumSuiObjectResponse = {
  object?: {
    objectId?: string;
    objectType?: string;
    previousTransaction?: string;
    package?: { storageId?: string; originalId?: string; modules?: Array<{ name?: string }> };
  };
};
export type TatumSuiTransactionResponse = {
  transaction?: { digest?: string; effects?: { status?: { success?: boolean } } };
};
export type TatumSuiBalanceResponse = { balance?: { coinType?: string; totalBalance?: string } };
export type StakeMateDeploymentVerification = {
  network: "testnet";
  chainIdentifier: string;
  packageId: string;
  packageType: "package";
  module: "challenge_escrow";
  publishTransaction: string;
  transactionStatus: "success";
};
export const STAKEMATE_TESTNET_PACKAGE = "0x3ad668c9afb9fe8540c9a3567aaee1e637f6392d414be3611f137658ef238392";
export const STAKEMATE_TESTNET_PUBLISH_TRANSACTION = "7WoZafsGnmWtqX91PHwX3vBAyMfU9bXQG9iNU7AEEDVf";

export class TatumSuiClient {
  readonly network: TatumSuiNetwork;
  private readonly endpoint: string;
  private readonly grpcEndpoint: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TatumSuiClientOptions = {}) {
    this.network = options.network ?? (process.env.TATUM_SUI_NETWORK as TatumSuiNetwork | undefined) ?? "testnet";
    if (!(this.network in endpoints)) throw new ProviderError("Unsupported Tatum Sui network.", "INVALID_RESPONSE");
    this.endpoint = options.endpoint ?? process.env.TATUM_SUI_RPC_URL ?? endpoints[this.network];
    if (!this.endpoint.startsWith("https://")) throw new ProviderError("Tatum endpoint must use HTTPS.", "INVALID_RESPONSE");
    this.grpcEndpoint = options.grpcEndpoint ?? process.env.TATUM_SUI_GRPC_ENDPOINT ?? grpcEndpoints[this.network];
    if (!/^[a-z0-9.-]+:\d+$/i.test(this.grpcEndpoint)) throw new ProviderError("Tatum gRPC endpoint must be a TLS authority.", "INVALID_RESPONSE");
    this.apiKey = options.apiKey ?? process.env.TATUM_API_KEY;
    const configuredTimeout = options.timeoutMs ?? Number(process.env.TATUM_TIMEOUT_MS ?? 8_000);
    if (!Number.isFinite(configuredTimeout) || configuredTimeout < 1 || configuredTimeout > 30_000) throw new ProviderError("Tatum timeout must be between 1 and 30000 milliseconds.", "INVALID_RESPONSE");
    this.timeoutMs = configuredTimeout;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.apiKey) throw new ProviderError("Tatum is not configured.", "NOT_CONFIGURED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new ProviderError("Tatum request failed.", "UPSTREAM", response.status);
      const payload = await response.json() as { result?: T; error?: { message?: string } };
      if (payload.error || payload.result === undefined) throw new ProviderError("Tatum returned an invalid RPC response.", "INVALID_RESPONSE");
      return payload.result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ProviderError("Tatum request timed out.", "TIMEOUT");
      throw new ProviderError("Tatum request could not be completed.", "UPSTREAM");
    } finally { clearTimeout(timer); }
  }

  async health(): Promise<TatumSuiHealth> {
    const info = await this.nativeCall("GetServiceInfo", {});
    const value = info as { chainId?: string; chain?: string };
    if (value.chain !== this.network || !value.chainId) throw new ProviderError("Tatum returned an unexpected Sui network.", "INVALID_RESPONSE");
    return { ok: true, network: this.network, chainIdentifier: value.chainId };
  }
  async getObject(objectId: string): Promise<TatumSuiObjectResponse | unknown> {
    return this.nativeCall("GetObject", { objectId, readMask: { paths: ["object_id", "object_type", "previous_transaction", "package.storage_id", "package.original_id", "package.modules.name"] } }) as Promise<TatumSuiObjectResponse>;
  }
  async getTransactionBlock(digest: string): Promise<TatumSuiTransactionResponse | unknown> {
    return this.nativeCall("GetTransaction", { digest, readMask: { paths: ["digest", "effects.status"] } }) as Promise<TatumSuiTransactionResponse>;
  }
  /** Read-only wallet SUI balance. No transaction execution surface is exposed. */
  async getSuiBalance(walletAddress: string): Promise<TatumSuiBalanceResponse> {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(walletAddress)) throw new ProviderError("Invalid Sui wallet address.", "INVALID_RESPONSE");
    return this.nativeCall("GetBalance", { owner: walletAddress, coinType: "0x2::sui::SUI" }) as Promise<TatumSuiBalanceResponse>;
  }
  /** Read-only deployment probe; no transaction execution or simulation is involved. */
  async readStakeMateTestnetDeployment(): Promise<StakeMateDeploymentVerification> {
    if (this.network !== "testnet") throw new ProviderError("StakeMate deployment probe is limited to Tatum Sui Testnet.", "INVALID_RESPONSE");
    // Tatum's gateway accepts each of these unary reads, but opening all three
    // TLS gRPC streams at once is not reliable in every serverless/runtime
    // network. Keep this deployment attestation deliberately bounded and
    // sequential: it is an infrequent, read-only verification and avoids
    // turning a valid package or transaction into a transient 503.
    const health = await this.health();
    const packageObject = await this.getObject(STAKEMATE_TESTNET_PACKAGE);
    const publishTransaction = await this.getTransactionBlock(STAKEMATE_TESTNET_PUBLISH_TRANSACTION);
    const packageResponse = packageObject as TatumSuiObjectResponse;
    const transactionResponse = publishTransaction as TatumSuiTransactionResponse;
    const moduleNames = packageResponse.object?.package?.modules?.map((module) => module.name) ?? [];
    if (packageResponse.object?.objectId !== STAKEMATE_TESTNET_PACKAGE || packageResponse.object.objectType !== "package" || !moduleNames.includes("challenge_escrow")) {
      throw new ProviderError("Tatum returned an unexpected StakeMate package.", "INVALID_RESPONSE");
    }
    if (transactionResponse.transaction?.digest !== STAKEMATE_TESTNET_PUBLISH_TRANSACTION || transactionResponse.transaction.effects?.status?.success !== true) {
      throw new ProviderError("Tatum returned an unexpected StakeMate publication transaction.", "INVALID_RESPONSE");
    }
    return { network: "testnet", chainIdentifier: health.chainIdentifier, packageId: STAKEMATE_TESTNET_PACKAGE, packageType: "package", module: "challenge_escrow", publishTransaction: STAKEMATE_TESTNET_PUBLISH_TRANSACTION, transactionStatus: "success" };
  }
  private async nativeCall(method: "GetServiceInfo" | "GetObject" | "GetTransaction" | "GetBalance", request: unknown): Promise<unknown> {
    if (!this.apiKey) throw new ProviderError("Tatum is not configured.", "NOT_CONFIGURED");
    const stateMethod = method === "GetBalance";
    const messages: Record<string, GrpcMessage> = stateMethod ? stateMessages : ledgerMessages; const requestType = messages[`${method}Request`]; const responseType = messages[`${method}Response`];
    if (!requestType || !responseType) throw new ProviderError("Official Sui gRPC definitions are unavailable.", "INVALID_RESPONSE");
    const client = new grpc.Client(this.grpcEndpoint, grpc.credentials.createSsl()); const metadata = new grpc.Metadata(); metadata.set("x-api-key", this.apiKey);
    const service = stateMethod ? "StateService" : "LedgerService";
    try { return await new Promise((resolve, reject) => client.makeUnaryRequest(`/sui.rpc.v2.${service}/${method}`, (value) => Buffer.from(requestType.toBinary(value)), (value) => responseType.fromBinary(value), request, metadata, { deadline: new Date(Date.now() + this.timeoutMs) }, (error, response) => error ? reject(error) : resolve(response))); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? Number((error as { code: unknown }).code) : undefined; if (code === grpc.status.DEADLINE_EXCEEDED) throw new ProviderError("Tatum request timed out.", "TIMEOUT"); throw new ProviderError("Tatum gRPC request failed.", "UPSTREAM", code); }
    finally { client.close(); }
  }
}

export function getTatumSuiClient(): TatumSuiClient { return new TatumSuiClient(); }
