// Copyright 2024 @paritytech/polkadot-staking-dashboard authors & contributors
// SPDX-License-Identifier: GPL-3.0-only

export const mimirExtensions: {
  title: string;
  website: string | [string, string];
  features: '*' | ('getAccounts' | 'subscribeAccounts' | 'signer');
  id: string;
}[] = [
  {
    features: '*',
    id: 'mimir',
    title: 'Mimir Wallet',
    website: 'app.mimir.global',
  },
];
