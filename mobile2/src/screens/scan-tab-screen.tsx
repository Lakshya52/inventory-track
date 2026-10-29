import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Package,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Truck,
  X,
  XCircle,
} from 'lucide-react-native';

import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { PageHeading } from '@/components/ui/page';
import { Screen } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { dispatchApi } from '@/services/dispatch';
import type {
  DispatchOrder,
  LoadingScanEvent,
  LoadingSession,
  ScanResult,
} from '@/types';

type FeedbackState = {
  result: ScanResult;
  message: string;
} | null;

export function ScanTabScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [activeSession, setActiveSession] = useState<LoadingSession | null>(null);
  const [events, setEvents] = useState<LoadingScanEvent[]>([]);
  const [approvedOrders, setApprovedOrders] = useState<DispatchOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Scanner controls
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  // Starting loading session
  const [startingOrderId, setStartingOrderId] = useState<string | null>(null);

  // Finalisation Modal
  const [finaliseModalVisible, setFinaliseModalVisible] = useState(false);
  const [sealNumber, setSealNumber] = useState('');
  const [outcome, setOutcome] = useState<'DISPATCHED' | 'NOT_DISPATCHED'>('DISPATCHED');
  const [remarks, setRemarks] = useState('');
  const [finalising, setFinalising] = useState(false);

  // Completed session banner
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);

  const loadActiveState = useCallback(async () => {
    try {
      const sessions = await dispatchApi.activeLoadingSessions();
      if (sessions && sessions.length > 0) {
        const current = sessions[0];
        setActiveSession(current);

        // Fetch scan history events
        try {
          const detail = await dispatchApi.getLoadingSession(current.id);
          setEvents(detail.events || []);
        } catch {
          // ignore event fetch errors
        }
      } else {
        setActiveSession(null);
        // Load approved orders ready to start
        const orders = await dispatchApi.myOrders({ status: 'APPROVED' });
        setApprovedOrders(orders || []);
      }
    } catch (err: any) {
      console.warn('Could not load loading session state:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // This starts an async API fetch; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadActiveState();
  }, [loadActiveState]);

  const onRefresh = () => {
    setRefreshing(true);
    setFeedback(null);
    void loadActiveState();
  };

  const handleStartSession = async (orderId: string | number) => {
    setStartingOrderId(String(orderId));
    setCompletedNotice(null);
    try {
      const res = await dispatchApi.startLoadingSession(orderId);
      setActiveSession(res.session);
      setEvents([]);
      setFeedback(null);
      void loadActiveState();
    } catch (err: any) {
      Alert.alert('Cannot Start Session', err?.message || 'Could not start loading session.');
    } finally {
      setStartingOrderId(null);
    }
  };

  const handleScanCode = async (qrValue: string) => {
    const code = qrValue.trim();
    if (!code || !activeSession || scanBusy) return;

    // Debounce duplicate camera triggers within 1.5 seconds
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.time < 1500) {
      return;
    }
    lastScanRef.current = { code, time: now };

    setScanBusy(true);
    setFeedback(null);

    try {
      const res = await dispatchApi.scan(activeSession.id, code);

      // Update counters locally
      setActiveSession((prev) =>
        prev
          ? {
              ...prev,
              scanned: res.scanned,
              total: res.total,
              progress: res.total > 0 ? Math.round((res.scanned / res.total) * 100) : 0,
            }
          : null
      );

      // Prepend event
      setEvents((prev) => [
        {
          id: res.event_id || `ev-${Date.now()}`,
          session_id: activeSession.id,
          qr_value: code,
          result: res.result,
          scanned_at: new Date().toISOString(),
          duplicate: res.duplicate,
        },
        ...prev.slice(0, 49),
      ]);

      if (res.result === 'OK') {
        setFeedback({
          result: 'OK',
          message: `Unit Scanned! (${res.scanned} of ${res.total} loaded)`,
        });
      } else if (res.result === 'DUPLICATE') {
        setFeedback({
          result: 'DUPLICATE',
          message: 'Already Scanned! This QR code was already recorded.',
        });
      } else if (res.result === 'WRONG_BATCH') {
        setFeedback({
          result: 'WRONG_BATCH',
          message: 'Wrong Batch! This QR label belongs to a different batch.',
        });
      } else if (res.result === 'QTY_EXCEEDED') {
        setFeedback({
          result: 'QTY_EXCEEDED',
          message: 'Batch Total Reached! All units have been loaded.',
        });
      }
      setManualCode('');
    } catch (err: any) {
      if (err?.code === 'QTY_EXCEEDED') {
        setFeedback({
          result: 'QTY_EXCEEDED',
          message: 'Batch Total Reached! Loaded count has reached the total.',
        });
      } else {
        setFeedback({
          result: 'WRONG_BATCH',
          message: err?.message || 'Scan failed. Please verify the QR code.',
        });
      }
    } finally {
      setScanBusy(false);
    }
  };

  const handleFinaliseSubmit = async () => {
    if (!activeSession) return;
    if (!sealNumber.trim()) {
      Alert.alert('Seal Number Required', 'Please enter a valid seal number to finalize.');
      return;
    }

    const hasShortfall = activeSession.scanned < activeSession.total;
    if (hasShortfall && outcome === 'DISPATCHED' && !remarks.trim()) {
      Alert.alert(
        'Remarks Required for Shortfall',
        `Only ${activeSession.scanned} of ${activeSession.total} units were scanned. Please provide a reason in remarks.`
      );
      return;
    }
    if (outcome === 'NOT_DISPATCHED' && !remarks.trim()) {
      Alert.alert('Remarks Required', 'Please provide an explanation for marking this batch as NOT DISPATCHED.');
      return;
    }

    setFinalising(true);
    try {
      await dispatchApi.finalise(activeSession.id, {
        seal_number: sealNumber.trim(),
        outcome,
        remarks: remarks.trim() || undefined,
      });

      setFinaliseModalVisible(false);
      setCompletedNotice(
        `Session finalized! Order marked as ${outcome} with Seal #${sealNumber.trim()}.`
      );
      setActiveSession(null);
      setEvents([]);
      setFeedback(null);
      setSealNumber('');
      setRemarks('');
      setIsCameraActive(false);
      void loadActiveState();
    } catch (err: any) {
      Alert.alert('Finalisation Error', err?.message || 'Could not finalize loading session.');
    } finally {
      setFinalising(false);
    }
  };

  const openFinaliseModal = () => {
    if (!activeSession) return;
    setFinaliseModalVisible(true);
    setSealNumber('');
    setRemarks('');
    setOutcome(activeSession.scanned >= activeSession.total ? 'DISPATCHED' : 'DISPATCHED');
  };

  const scannedCount = activeSession?.scanned ?? 0;
  const totalCount = activeSession?.total ?? 0;
  const progressPercent =
    totalCount > 0 ? Math.min(100, Math.round((scannedCount / totalCount) * 100)) : 0;

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#011A87']} />
        }>
        <View className="px-5 pt-6">
          <PageHeading
            title="Scan & Loading"
            subtitle="Unit-level scanning with live progress & seal verification"
          />

          {/* Success banner if a session was just finalized */}
          {completedNotice ? (
            <View className="mt-4 flex-row items-center justify-between rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-3.5">
              <View className="flex-1 flex-row items-center gap-2">
                <CheckCircle2 size={18} color="#16A34A" />
                <AppText className="flex-1 text-[12px] font-manrope-bold text-[#15803D]">
                  {completedNotice}
                </AppText>
              </View>
              <Pressable onPress={() => setCompletedNotice(null)} className="p-1">
                <X size={15} color="#15803D" />
              </Pressable>
            </View>
          ) : null}

          {/* SECTION 1: ACTIVE LOADING SESSION IN PROGRESS */}
          {activeSession ? (
            <View className="mt-5">
              {/* Active Session Info Card */}
              <View className="rounded-[18px] border border-[#CCDDF5] bg-white p-5 shadow-sm">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-2">
                    <AppText className="text-[11px] font-manrope-bold uppercase tracking-wider text-[#71829B]">
                      Active Loading Session
                    </AppText>
                    <AppText
                      className="mt-0.5 text-[18px] text-navy"
                      style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                      {activeSession.product_name || 'Product'}
                    </AppText>
                    <AppText variant="caption" className="mt-0.5 text-[12px] text-[#4E5D76]">
                      Batch: {activeSession.batch_number || 'N/A'} · Order #{activeSession.dispatch_order_id}
                    </AppText>
                  </View>
                  <StatusBadge status="LOADING" label="LOADING" />
                </View>

                {/* Live Loading Preview Counter: e.g. 10/100 */}
                <View className="mt-5 rounded-2xl bg-[#F0F5FD] p-4 border border-[#D8E6FC]">
                  <View className="flex-row items-baseline justify-between">
                    <View className="flex-row items-baseline gap-1.5">
                      <AppText
                        className="text-[34px] leading-tight text-navy"
                        style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                        {scannedCount}
                      </AppText>
                      <AppText
                        className="text-[20px] font-manrope-bold text-[#71829B]">
                        / {totalCount}
                      </AppText>
                      <AppText variant="caption" className="ml-1 text-[12px] font-manrope-semibold text-[#4E5D76]">
                        units loaded
                      </AppText>
                    </View>
                    <View className="rounded-full bg-navy px-3 py-1">
                      <AppText className="text-[12px] font-manrope-bold text-white">
                        {progressPercent}%
                      </AppText>
                    </View>
                  </View>

                  {/* Progress Bar */}
                  <View className="mt-3 h-3 w-full overflow-hidden rounded-full bg-[#D4E3FA]">
                    <View
                      className="h-full rounded-full bg-navy"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </View>
                </View>

                {/* Instant Feedback Banner */}
                {feedback ? (
                  <View
                    className={`mt-4 flex-row items-center gap-2 rounded-xl border p-3 ${
                      feedback.result === 'OK'
                        ? 'border-[#BBF7D0] bg-[#F0FDF4]'
                        : feedback.result === 'DUPLICATE'
                          ? 'border-[#FED7AA] bg-[#FFFBEB]'
                          : 'border-[#FCA5A5] bg-[#FEF2F2]'
                    }`}>
                    {feedback.result === 'OK' ? (
                      <CheckCircle2 size={18} color="#16A34A" />
                    ) : feedback.result === 'DUPLICATE' ? (
                      <AlertTriangle size={18} color="#D97706" />
                    ) : (
                      <XCircle size={18} color="#DC2626" />
                    )}
                    <AppText
                      className={`flex-1 text-[12px] font-manrope-bold ${
                        feedback.result === 'OK'
                          ? 'text-[#15803D]'
                          : feedback.result === 'DUPLICATE'
                            ? 'text-[#B45309]'
                            : 'text-[#B91C1C]'
                      }`}>
                      {feedback.message}
                    </AppText>
                  </View>
                ) : null}

                {/* Scanning Interface */}
                <View className="mt-5">
                  <View className="flex-row items-center justify-between mb-2">
                    <AppText variant="label" className="text-[11px]">
                      Unit QR Scanner
                    </AppText>
                    <Pressable
                      onPress={() => {
                        if (!permission?.granted) {
                          requestPermission();
                        }
                        setIsCameraActive((prev) => !prev);
                      }}
                      className="flex-row items-center gap-1 rounded-full bg-[#EBF3FF] px-2.5 py-1">
                      <Camera size={12} color="#011A87" />
                      <AppText className="text-[10.5px] font-manrope-bold text-navy">
                        {isCameraActive ? 'Hide Camera' : 'Open Camera'}
                      </AppText>
                    </Pressable>
                  </View>

                  {/* Camera View */}
                  {isCameraActive ? (
                    <View className="h-[230px] w-full overflow-hidden rounded-2xl border-2 border-navy bg-black mb-3.5 relative">
                      {permission?.granted ? (
                        <CameraView
                          facing="back"
                          barcodeScannerSettings={{
                            barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'upc_a'],
                          }}
                          onBarcodeScanned={
                            scanBusy
                              ? undefined
                              : (result) => {
                                  if (result.data) {
                                    void handleScanCode(result.data);
                                  }
                                }
                          }
                          style={{ flex: 1 }}
                        />
                      ) : (
                        <View className="flex-1 items-center justify-center p-4">
                          <Camera size={32} color="#94A3B8" />
                          <AppText className="mt-2 text-center text-[12px] text-white font-manrope-medium">
                            Camera permission is needed to scan unit QR codes.
                          </AppText>
                          <PrimaryButton
                            label="Grant Permission"
                            size="md"
                            className="mt-3 px-4"
                            onPress={requestPermission}
                          />
                        </View>
                      )}

                      {/* Aiming Reticle Overlay */}
                      {permission?.granted ? (
                        <View className="pointer-events-none absolute inset-0 items-center justify-center">
                          <View className="h-36 w-36 rounded-xl border-2 border-white/80 bg-transparent" />
                          <AppText className="mt-2 text-[10.5px] font-manrope-bold text-white bg-black/60 px-2.5 py-0.5 rounded-full">
                            Point camera at unit QR code
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {/* Manual / Barcode Gun Input */}
                  <View className="flex-row gap-2">
                    <TextInput
                      value={manualCode}
                      onChangeText={setManualCode}
                      placeholder="Or enter / scan QR code manually..."
                      placeholderTextColor="#8A98AC"
                      autoCapitalize="none"
                      className="h-11 flex-1 rounded-xl border border-line bg-white px-3.5 font-manrope-medium text-[12px] text-navy"
                      onSubmitEditing={() => handleScanCode(manualCode)}
                    />
                    <PrimaryButton
                      label={scanBusy ? '...' : 'Scan'}
                      icon={QrCode}
                      size="md"
                      disabled={!manualCode.trim() || scanBusy}
                      onPress={() => handleScanCode(manualCode)}
                    />
                  </View>
                </View>

                {/* Finalise Dispatch Button */}
                <View className="mt-5 border-t border-line pt-4">
                  <PrimaryButton
                label="Seal & Finalise Dispatch"
                    icon={ShieldCheck}
                    onPress={openFinaliseModal}
                  />
                  <AppText variant="tiny" className="mt-2 text-center text-[10px] text-[#71829B]">
                    {scannedCount < totalCount
                      ? 'Note: Loading is below total quantity. Shortfall reason will be required.'
                      : 'All units scanned. Ready to record seal number and dispatch.'}
                  </AppText>
                </View>
              </View>

              {/* Recent Scan History */}
              <View className="mt-6">
                <View className="flex-row items-center justify-between mb-2.5">
                  <AppText variant="label" className="text-[12px]">
                    Recent Scan Events ({events.length})
                  </AppText>
                  <Pressable onPress={onRefresh} className="flex-row items-center gap-1">
                    <RefreshCw size={12} color="#011A87" />
                    <AppText className="text-[11px] font-manrope-bold text-navy">
                      Refresh
                    </AppText>
                  </Pressable>
                </View>

                {events.length === 0 ? (
                  <View className="rounded-xl border border-dashed border-line bg-white p-4 items-center">
                    <AppText variant="caption" className="text-[11px]">
                      No units scanned yet in this session.
                    </AppText>
                  </View>
                ) : (
                  <View className="gap-2">
                    {events.slice(0, 15).map((ev, idx) => (
                      <View
                        key={ev.id || idx}
                        className="flex-row items-center justify-between rounded-xl border border-line bg-white px-3.5 py-2.5">
                        <View className="flex-1 pr-2">
                          <AppText className="text-[12px] font-manrope-bold text-navy" numberOfLines={1}>
                            {ev.qr_value}
                          </AppText>
                          <AppText variant="tiny" className="text-[10px] text-[#71829B]">
                            {ev.scanned_at ? new Date(ev.scanned_at).toLocaleTimeString() : 'Just now'}
                          </AppText>
                        </View>
                        <StatusBadge
                          status={ev.result === 'OK' ? 'passed' : ev.result === 'DUPLICATE' ? 'pending' : 'failed'}
                          label={ev.result}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          ) : (
            /* SECTION 2: NO ACTIVE LOADING SESSION - SHOW APPROVED ORDERS READY TO LOAD */
            <View className="mt-5">
              <View className="rounded-2xl border border-[#D4E3FA] bg-white p-5">
                <View className="flex-row items-center gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-[#EBF3FF]">
                    <Truck size={20} color="#011A87" />
                  </View>
                  <View className="flex-1">
                    <AppText variant="h2" className="text-[16px]">
                      No Active Loading Session
                    </AppText>
                    <AppText variant="caption" className="text-[11px]">
                      Select an approved order below to begin scanning.
                    </AppText>
                  </View>
                </View>
              </View>

              <AppText variant="label" className="mt-6 mb-3 text-[12px]">
                Approved Orders Ready for Loading ({approvedOrders.length})
              </AppText>

              {loading ? (
                <View className="items-center py-8">
                  <AppText variant="caption">Loading approved orders...</AppText>
                </View>
              ) : approvedOrders.length === 0 ? (
                <View className="items-center rounded-2xl border border-dashed border-[#CCD7E6] bg-white px-6 py-10">
                  <Package size={32} color="#9AA6B8" strokeWidth={1.5} />
                  <AppText variant="h2" className="mt-2 text-[15px]">
                    No Approved Orders
                  </AppText>
                  <AppText variant="caption" className="mt-1 text-center text-[11px]">
                    There are no QC-approved dispatch orders waiting to be loaded. Raise a new request or wait for QC approval.
                  </AppText>
                </View>
              ) : (
                <View className="gap-3">
                  {approvedOrders.map((order) => (
                    <View
                      key={order.id}
                      className="rounded-2xl border border-[#D4E3FA] bg-white p-4 shadow-sm">
                      <View className="flex-row items-start justify-between">
                        <View className="flex-1 pr-2">
                          <AppText className="text-[11px] font-manrope-bold text-[#71829B]">
                            Order #{order.id}
                          </AppText>
                          <AppText
                            className="mt-0.5 text-[15px] text-navy"
                            style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                            {order.product_name || 'Product'}
                          </AppText>
                          <AppText variant="caption" className="text-[11px] text-[#4E5D76]">
                            Batch #{order.batch_number || 'N/A'} · Qty: {order.quantity ?? '-'} {order.uom || 'units'}
                          </AppText>
                        </View>
                        <StatusBadge status="APPROVED" label="APPROVED" />
                      </View>

                      <View className="mt-3 rounded-xl bg-canvas p-2.5">
                        <AppText variant="tiny" className="text-[10px] text-[#71829B]">
                          Customer: <AppText className="font-manrope-bold text-navy">{order.client_name || 'N/A'}</AppText>
                        </AppText>
                        <AppText variant="tiny" className="mt-0.5 text-[10px] text-[#71829B]">
                          Transport: {order.driver_name || '-'} · {order.vehicle_number || '-'} · {order.container_number || '-'}
                        </AppText>
                      </View>

                      <PrimaryButton
                        label={startingOrderId === String(order.id) ? 'Starting...' : 'Start Loading Session'}
                        icon={Truck}
                        size="md"
                        disabled={startingOrderId === String(order.id)}
                        className="mt-3"
                        onPress={() => handleStartSession(order.id)}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* FINALISE LOADING MODAL */}
      <Modal
        visible={finaliseModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFinaliseModalVisible(false)}>
        <View className="flex-1 justify-end bg-black/45">
          <Pressable className="flex-1" onPress={() => setFinaliseModalVisible(false)} />
          <View className="max-h-[85%] rounded-t-[26px] bg-white px-5 pt-5 pb-8">
            <View className="flex-row items-center justify-between pb-3 border-b border-line">
              <View>
                <AppText variant="h2" className="text-[18px]">
                  Seal &amp; Finalise Dispatch
                </AppText>
                <AppText variant="caption" className="text-[11px]">
                  Record seal number and mark final outcome
                </AppText>
              </View>
              <Pressable
                onPress={() => setFinaliseModalVisible(false)}
                className="h-8 w-8 items-center justify-center rounded-full bg-canvas">
                <X size={17} color="#001A6E" />
              </Pressable>
            </View>

            <ScrollView className="mt-3" showsVerticalScrollIndicator={false}>
              {/* Shortfall warning */}
              {activeSession && activeSession.scanned < activeSession.total ? (
                <View className="mb-4 rounded-xl border border-[#FED7AA] bg-[#FFFBEB] p-3 flex-row items-start gap-2">
                  <AlertTriangle size={17} color="#D97706" />
                  <View className="flex-1">
                    <AppText className="text-[12px] font-manrope-bold text-[#B45309]">
                      Shortfall Notice ({activeSession.scanned} of {activeSession.total} scanned)
                    </AppText>
                    <AppText className="mt-0.5 text-[11px] text-[#92400E]">
                      The loaded quantity is less than the batch quantity. You must provide a reason in the remarks field.
                    </AppText>
                  </View>
                </View>
              ) : null}

              {/* Seal Number input */}
              <AppText variant="label" className="mb-1 text-[11px]">
                Tamper-Evident Seal Number *
              </AppText>
              <TextInput
                value={sealNumber}
                onChangeText={setSealNumber}
                placeholder="Enter container seal number (e.g. SEAL-88492) *"
                placeholderTextColor="#8A98AC"
                autoCapitalize="characters"
                className="h-11 rounded-xl border border-line bg-white px-3.5 font-manrope-medium text-[13px] text-navy mb-4"
              />

              {/* Outcome Selection */}
              <AppText variant="label" className="mb-1 text-[11px]">
                Mark Outcome *
              </AppText>
              <View className="flex-row gap-2.5 mb-4">
                <Pressable
                  onPress={() => setOutcome('DISPATCHED')}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-3 ${
                    outcome === 'DISPATCHED'
                      ? 'border-[#16A34A] bg-[#F0FDF4]'
                      : 'border-line bg-white'
                  }`}>
                  <CheckCircle2
                    size={16}
                    color={outcome === 'DISPATCHED' ? '#16A34A' : '#71829B'}
                  />
                  <AppText
                    className={`text-[12.5px] ${
                      outcome === 'DISPATCHED'
                        ? 'font-manrope-bold text-[#15803D]'
                        : 'text-[#4E5D76] font-manrope-medium'
                    }`}>
                    DISPATCHED
                  </AppText>
                </Pressable>

                <Pressable
                  onPress={() => setOutcome('NOT_DISPATCHED')}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-3 ${
                    outcome === 'NOT_DISPATCHED'
                      ? 'border-[#DC2626] bg-[#FEF2F2]'
                      : 'border-line bg-white'
                  }`}>
                  <XCircle
                    size={16}
                    color={outcome === 'NOT_DISPATCHED' ? '#DC2626' : '#71829B'}
                  />
                  <AppText
                    className={`text-[12.5px] ${
                      outcome === 'NOT_DISPATCHED'
                        ? 'font-manrope-bold text-[#B91C1C]'
                        : 'text-[#4E5D76] font-manrope-medium'
                    }`}>
                    NOT DISPATCHED
                  </AppText>
                </Pressable>
              </View>

              {/* Remarks */}
              <AppText variant="label" className="mb-1 text-[11px]">
                Remarks {activeSession && (activeSession.scanned < activeSession.total || outcome === 'NOT_DISPATCHED') ? '*' : '(Optional)'}
              </AppText>
              <TextInput
                value={remarks}
                onChangeText={setRemarks}
                placeholder="Reason for shortfall, carrier notes, or exception..."
                placeholderTextColor="#8A98AC"
                multiline
                numberOfLines={3}
                className="rounded-xl border border-line bg-white p-3 font-manrope-medium text-[12px] text-navy mb-5"
                style={{ height: 75, textAlignVertical: 'top' }}
              />

              <PrimaryButton
                label={finalising ? 'Finalizing Session...' : 'Confirm & Finalise Dispatch'}
                disabled={finalising || !sealNumber.trim()}
                icon={ShieldCheck}
                onPress={handleFinaliseSubmit}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
