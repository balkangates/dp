/**
 * src/payment/usePayment.ts
 * Gerçek şemaya göre düzenlenmiş — expires_at Date olarak hesaplanır
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  createPaymentIntent,
  verifyPayment,
  getPaymentStatus,
  formatCountdown,
  buildTronscanUrl,
  POLL_INTERVAL_MS,
  type PaymentIntent,
  type PaymentFlowStatus,
} from './usdtPaymentService';
import type { PlanId } from '../subscription/subscriptionConfig';

export type PaymentFlowState =
  | 'idle'
  | 'creating'
  | 'awaiting_tx'
  | 'verifying'
  | 'confirmed'
  | 'failed'
  | 'expired';

export interface UsePaymentReturn {
  flowState:   PaymentFlowState;
  intent:      PaymentIntent | null;
  error:       string;
  countdown:   string;
  loading:     boolean;
  tronscanUrl: string | null;
  start:  (plan: 'PRO' | 'VIP') => Promise<void>;
  submit: (txHash: string)       => Promise<void>;
  reset:  ()                     => void;
}

export function usePayment(onSuccess?: (plan: PlanId) => void): UsePaymentReturn {
  const { user } = useAuth();

  const [flowState,   setFlowState]   = useState<PaymentFlowState>('idle');
  const [intent,      setIntent]      = useState<PaymentIntent | null>(null);
  const [error,       setError]       = useState('');
  const [countdown,   setCountdown]   = useState('');
  const [loading,     setLoading]     = useState(false);
  const [tronscanUrl, setTronscanUrl] = useState<string | null>(null);

  const intentRef    = useRef<PaymentIntent | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => _clearAll(), []);

  function _clearPoller()    { if (pollRef.current)      { clearInterval(pollRef.current);      pollRef.current = null;      } }
  function _clearCountdown() { if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; } }
  function _clearAll()       { _clearPoller(); _clearCountdown(); }

  function _startCountdown(expiresAt: Date) {
    _clearCountdown();
    const tick = () => {
      const s = formatCountdown(expiresAt);
      setCountdown(s);
      if (s === '00:00') {
        _clearCountdown();
        setFlowState('expired');
        setError('Ödeme süresi doldu. Lütfen yeniden başlatın.');
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
  }

  function _startPoller(paymentId: string, userId: string) {
    _clearPoller();
    pollRef.current = setInterval(async () => {
      const status: PaymentFlowStatus = await getPaymentStatus(paymentId, userId);
      if (status === 'confirmed') {
        _clearAll();
        setFlowState('confirmed');
        if (intentRef.current) onSuccess?.(intentRef.current.plan);
      } else if (status === 'expired' || status === 'failed') {
        _clearAll();
        setFlowState(status);
        if (status === 'expired') setError('Ödeme süresi doldu. Lütfen yeniden başlatın.');
      }
    }, POLL_INTERVAL_MS);
  }

  const start = useCallback(async (plan: 'PRO' | 'VIP') => {
    if (!user?.id) { setError('Lütfen önce giriş yapın.'); return; }
    _clearAll();
    setError('');
    setLoading(true);
    setFlowState('creating');

    const { data, error: err } = await createPaymentIntent(user.id, plan);
    setLoading(false);

    if (err || !data) {
      setFlowState('failed');
      setError(err ?? 'Ödeme başlatılamadı.');
      return;
    }

    intentRef.current = data;
    setIntent(data);
    setFlowState('awaiting_tx');
    _startCountdown(data.expiresAt);
    _startPoller(data.id, user.id);
  }, [user?.id]);

  const submit = useCallback(async (txHash: string) => {
    if (!user?.id || !intent) return;
    if (!txHash.trim()) { setError('TX hash boş olamaz.'); return; }

    setLoading(true);
    setError('');
    setFlowState('verifying');

    const result = await verifyPayment({ paymentId: intent.id, txHash: txHash.trim(), userId: user.id });
    setLoading(false);

    if (result.success) {
      _clearAll();
      setTronscanUrl(buildTronscanUrl(txHash.trim()));
      setFlowState('confirmed');
      onSuccess?.(intent.plan);
    } else {
      setError(result.message);
      setFlowState(result.status === 'expired' ? 'expired' : 'awaiting_tx');
    }
  }, [user?.id, intent, onSuccess]);

  const reset = useCallback(() => {
    _clearAll();
    setFlowState('idle');
    setIntent(null);
    setError('');
    setCountdown('');
    setLoading(false);
    setTronscanUrl(null);
    intentRef.current = null;
  }, []);

  return { flowState, intent, error, countdown, loading, tronscanUrl, start, submit, reset };
}
