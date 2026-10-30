"use client";

import dynamic from "next/dynamic";

const WalletProviderClient = dynamic(() => import("./WalletProviderClient").then((module) => module.WalletProviderClient), { ssr: false });
export function WalletProvider({ children }: Readonly<{ children: React.ReactNode }>) { return <WalletProviderClient>{children}</WalletProviderClient>; }
