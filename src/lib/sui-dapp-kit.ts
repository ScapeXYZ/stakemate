"use client";

import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export const STAKEMATE_SUI_NETWORK = "testnet" as const;
export const dAppKit = createDAppKit({
  networks: [STAKEMATE_SUI_NETWORK],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: "https://fullnode.testnet.sui.io:443" }),
});

declare module "@mysten/dapp-kit-react" { interface Register { dAppKit: typeof dAppKit; } }
