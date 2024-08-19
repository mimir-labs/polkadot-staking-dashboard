// Copyright 2024 @polkadot-cloud/polkadot-staking-dashboard authors & contributors
// SPDX-License-Identifier: GPL-3.0-only

import BigNumber from 'bignumber.js';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DappName, ManualSigners } from 'consts';
import { useApi } from 'contexts/Api';
import { useLedgerHardware } from 'contexts/LedgerHardware';
import { useTxMeta } from 'contexts/TxMeta';
import type { AnyApi } from 'types';
import { useActiveAccounts } from 'contexts/ActiveAccounts';
import { useImportedAccounts } from 'contexts/Connect/ImportedAccounts';
import { useBuildPayload } from '../useBuildPayload';
import { useProxySupported } from '../useProxySupported';
import type { UseSubmitExtrinsic, UseSubmitExtrinsicProps } from './types';
import { NotificationsController } from 'controllers/Notifications';
import { useExtensions } from '@w3ux/react-connect-kit';
import { checkCall } from '@mimirdev/apps-sdk';

export const useSubmitExtrinsic = ({
  tx,
  from,
  shouldSubmit,
  callbackSubmit,
  callbackInBlock,
}: UseSubmitExtrinsicProps): UseSubmitExtrinsic => {
  const { t } = useTranslation('library');
  const { api } = useApi();
  const { buildPayload } = useBuildPayload();
  const { activeProxy } = useActiveAccounts();
  const { extensionsStatus } = useExtensions();
  const { isProxySupported } = useProxySupported();
  const { handleResetLedgerTask } = useLedgerHardware();
  const { addPendingNonce, removePendingNonce } = useTxMeta();
  const { getAccount, requiresManualSign } = useImportedAccounts();
  const {
    txFees,
    setTxFees,
    setSender,
    getTxPayload,
    getTxSignature,
    setTxSignature,
    resetTxPayload,
    incrementPayloadUid,
  } = useTxMeta();

  // Store given tx as a ref.
  const txRef = useRef<AnyApi>(tx);

  // Store given submit address as a ref.
  const fromRef = useRef<string>(from || '');

  // Store whether the transaction is in progress.
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Store the uid of the extrinsic.
  const [uid] = useState<number>(incrementPayloadUid());

  // Track for one-shot transaction reset after submission.
  const didTxReset = useRef<boolean>(false);

  // If proxy account is active, wrap tx in a proxy call and set the sender to the proxy account.
  const wrapTxIfActiveProxy = () => {
    // if already wrapped, update fromRef and return.
    if (
      txRef.current?.method.toHuman().section === 'proxy' &&
      txRef.current?.method.toHuman().method === 'proxy'
    ) {
      if (activeProxy) {
        fromRef.current = activeProxy;
      }
      return;
    }

    if (
      api &&
      activeProxy &&
      txRef.current &&
      isProxySupported(txRef.current, fromRef.current)
    ) {
      // update submit address to active proxy account.
      fromRef.current = activeProxy;

      // Do not wrap batch transactions. Proxy calls should already be wrapping each tx within the
      // batch via `useBatchCall`.
      if (
        txRef.current?.method.toHuman().section === 'utility' &&
        txRef.current?.method.toHuman().method === 'batch'
      ) {
        return;
      }

      // Not a batch transaction: wrap tx in proxy call.
      txRef.current = api.tx.proxy.proxy(
        {
          id: from,
        },
        null,
        txRef.current
      );
    }
  };

  // Calculate the estimated tx fee of the transaction.
  const calculateEstimatedFee = async () => {
    if (txRef.current === null) {
      return;
    }
    // get payment info
    const { partialFee } = await txRef.current.paymentInfo(fromRef.current);
    const partialFeeBn = new BigNumber(partialFee.toString());

    // give tx fees to global useTxMeta context
    if (partialFeeBn.toString() !== txFees.toString()) {
      setTxFees(partialFeeBn);
    }
  };

  // Extrinsic submission handler.
  const onSubmit = async () => {
    const account = getAccount(fromRef.current);
    if (
      account === null ||
      submitting ||
      !shouldSubmit ||
      !api ||
      (requiresManualSign(fromRef.current) && !getTxSignature())
    ) {
      return;
    }

    const nonce = (
      await api.rpc.system.accountNextIndex(fromRef.current)
    ).toHuman();

    const { source } = account;

    // if `activeAccount` is imported from an extension, ensure it is enabled.
    if (!ManualSigners.includes(source)) {
      const isInstalled = Object.entries(extensionsStatus).find(
        ([id, status]) => id === source && status === 'connected'
      );

      if (!isInstalled) {
        throw new Error(`${t('walletNotFound')}`);
      }

      if (!window?.injectedWeb3?.[source]) {
        throw new Error(`${t('walletNotFound')}`);
      }

      // summons extension popup if not already connected.
      window.injectedWeb3[source].enable(DappName);
    }

    const onReady = () => {
      addPendingNonce(nonce);
      NotificationsController.emit({
        title: t('pending'),
        subtitle: t('transactionInitiated'),
      });
      if (callbackSubmit && typeof callbackSubmit === 'function') {
        callbackSubmit();
      }
    };

    const onInBlock = () => {
      setSubmitting(false);
      removePendingNonce(nonce);
      NotificationsController.emit({
        title: t('inBlock'),
        subtitle: t('transactionInBlock'),
      });
      if (callbackInBlock && typeof callbackInBlock === 'function') {
        callbackInBlock();
      }
    };

    const onFinalizedEvent = (method: string) => {
      if (method === 'ExtrinsicSuccess') {
        NotificationsController.emit({
          title: t('finalized'),
          subtitle: t('transactionSuccessful'),
        });
      } else if (method === 'ExtrinsicFailed') {
        NotificationsController.emit({
          title: t('failed'),
          subtitle: t('errorWithTransaction'),
        });
        setSubmitting(false);
        removePendingNonce(nonce);
      }
    };

    const resetTx = () => {
      resetTxPayload();
      setTxSignature(null);
      setSubmitting(false);
    };

    const resetManualTx = () => {
      resetTx();
      handleResetLedgerTask();
    };

    const onError = (type?: string) => {
      resetTx();
      if (type === 'ledger') {
        handleResetLedgerTask();
      }
      removePendingNonce(nonce);
      NotificationsController.emit({
        title: t('cancelled'),
        subtitle: t('transactionCancelled'),
      });
    };

    const handleStatus = (status: AnyApi) => {
      if (status.isReady) {
        onReady();
      }
      if (status.isInBlock) {
        onInBlock();
      }
    };

    const unsubEvents = ['ExtrinsicSuccess', 'ExtrinsicFailed'];

    // pre-submission state update
    setSubmitting(true);

    const txPayloadValue = getTxPayload();
    const txSignature = getTxSignature();

    // handle signed transaction.
    if (getTxSignature()) {
      try {
        txRef.current.addSignature(
          fromRef.current,
          txSignature,
          txPayloadValue.toHex()
        );

        const unsub = await txRef.current.send(
          ({ status, events = [] }: AnyApi) => {
            if (!didTxReset.current) {
              didTxReset.current = true;
              resetManualTx();
            }

            handleStatus(status);
            if (status.isFinalized) {
              events.forEach(({ event: { method } }: AnyApi) => {
                onFinalizedEvent(method);
                if (unsubEvents?.includes(method)) {
                  unsub();
                }
              });
            }
          }
        );
      } catch (e) {
        onError(ManualSigners.includes(source) ? source : 'default');
      }
    } else {
      // handle unsigned transaction.
      const { signer } = account;
      try {
        if (source === 'mimir') {
          const result = await signer.signPayload({
            address: fromRef.current,
            method: txRef.current.method.toHex(),
            genesisHash: api.genesisHash.toHex(),
          });

          const call = api.registry.createType('Call', result.payload.method);

          if (!checkCall(api, call, txRef.current.method)) {
            throw new Error('not safe tx');
          }

          const newTx = api.tx[call.section][call.method](...call.args);

          newTx.addSignature(result.signer, result.signature, result.payload);

          const unsub = await newTx.send(({ status, events = [] }: AnyApi) => {
            if (!didTxReset.current) {
              didTxReset.current = true;
              resetTx();
            }

            handleStatus(status);
            if (status.isFinalized) {
              events.forEach(({ event: { method } }: AnyApi) => {
                onFinalizedEvent(method);
                if (unsubEvents?.includes(method)) {
                  unsub();
                }
              });
            }
          });
        } else {
          const unsub = await txRef.current.signAndSend(
            fromRef.current,
            { signer, withSignedTransaction: true },
            ({ status, events = [] }: AnyApi) => {
              if (!didTxReset.current) {
                didTxReset.current = true;
                resetTx();
              }

              handleStatus(status);
              if (status.isFinalized) {
                events.forEach(({ event: { method } }: AnyApi) => {
                  onFinalizedEvent(method);
                  if (unsubEvents?.includes(method)) {
                    unsub();
                  }
                });
              }
            }
          );
        }
      } catch (e) {
        onError('default');
      }
    }
  };

  // Refresh state upon `tx` updates.
  useEffect(() => {
    // update txRef to latest tx.
    txRef.current = tx;
    // update submit address to latest from.
    fromRef.current = from || '';
    // wrap tx in proxy call if active proxy & proxy supported.
    wrapTxIfActiveProxy();
    // ensure sender is up to date.
    setSender(fromRef.current);
    // re-calculate estimated tx fee.
    calculateEstimatedFee();
    // rebuild tx payload.
    buildPayload(txRef.current, fromRef.current, uid);
  }, [tx?.toString(), tx?.method?.args?.calls?.toString(), from]);

  return {
    uid,
    onSubmit,
    submitting,
    submitAddress: fromRef.current,
    proxySupported: isProxySupported(txRef.current, fromRef.current),
  };
};
