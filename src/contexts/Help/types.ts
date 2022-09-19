// Copyright 2022 @paritytech/polkadot-staking-dashboard authors & contributors
// SPDX-License-Identifier: Apache-2.0

import { ReactNode } from 'react';
import { MaybeString } from 'types';

export type AssistantConfig = Array<AssistantItem>;

export interface AssistantItem {
  key?: string;
  definitions?: HelpDefinitions;
  external?: HelpExternals;
}

export type HelpExternals = Array<HelpExternal>;

export type HelpDefinitions = Array<HelpDefinition>;

export type HelpDefinition = {
  title: string;
  description: string[];
};

export interface HelpExternal {
  label: string;
  title: string;
  subtitle: string;
  url: string;
  website?: string;
}

export interface HelpContextInterface {
  openHelpWith: (d: MaybeString, c: HelpConfig) => void;
  closeHelp: () => void;
  setStatus: (s: number) => void;
  setCategory: (c: MaybeString) => void;
  setDefinition: (d: MaybeString) => void;
  fillDefinitionVariables: (d: HelpDefinition) => HelpDefinition;
  status: number;
  definition: MaybeString;
  category: MaybeString;
}

export interface HelpContextState {
  status: number;
  definition: MaybeString;
  config: HelpConfig;
}

export interface HelpContextProps {
  children: ReactNode;
}

export type HelpConfig = Record<string, string | any>;
