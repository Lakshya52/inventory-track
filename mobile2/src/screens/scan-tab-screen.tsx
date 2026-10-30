import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  AlertTriangle,
  Ban,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Package,
  QrCode,
  RefreshCw,
  Search,
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

type NoticeState = {
  tone: 'success' | 'info';
  message: string;
} | null;

export function ScanTabScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [activeSession, setActiveSession] = useState<LoadingSession | null>(null);
  const [events, setEvents] = useState<LoadingScanEvent[]>([]);
  const [approvedOrders, setApprovedOrders] = useState<DispatchOrder[]>([]);
  const [orderQuery, setOrderQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Scanner controls
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [refreshingEvents, setRefreshingEvents] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  // Starting loading session
  const [startingOrderId, setStartingOrderId] = useState<string | null>(null);

  // Cancelling a session that has no scans yet
  const [cancelling, setCancelling] = useState(false);

  // Finalisation Modal
  const [finaliseModalVisible, setFinaliseModalVisible] = useState(false);
  const [sealNumber, setSealNumber] = useState('');
  const [outcome, setOutcome] = useState<'DISPATCHED' | 'NOT_DISPATCHED'>('DISPATCHED');
  const [remarks, setRemarks] = useState('');
  const [finalising, setFinalising] = useState(false);

  // Banner shown after a session is finalised or cancelled
  const [notice, setNotice] = useState<NoticeState>(null);

  const loadActiveState = useCallback(async () => {
    try {
      setLoadError(null);
      const sessions = await dispatchApi.activeLoadingSessions();
      if (sessions && sessions.length > 0) {
        const current = sessions[0];
        setActiveSession(current);

        // Fetch scan history events
        try {
          const detail = await dispatchApi.getLoadingSession(current.id);
          setEvents(detail.events || []);
        } catch {
          // Keep the session usable even if the history request fails.
        }
      } else {
        setActiveSession(null);
        setEvents([]);
        // Load approved orders ready to start
        const orders = await dispatchApi.myOrders({ status: 'APPROVED' });
        setApprovedOrders(orders || []);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load your loading sessions.');
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

  const refreshEvents = async () => {
    if (!activeSession || refreshingEvents) return;
    setRefreshingEvents(true);
    try {
      const detail = await dispatchApi.getLoadingSession(activeSession.id);
      setEvents(detail.events || []);
    } catch {
      // Silent: the next scan or pull-to-refresh will resync the history.
    } finally {
      setRefreshingEvents(false);
    }
  };

  const toggleCamera = () => {
    if (!permission?.granted) {
      void requestPermission();
    }
    setIsCameraActive((prev) => !prev);
  };

  const handleStartSession = async (orderId: string | number) => {
    if (startingOrderId) return;
    setStartingOrderId(String(orderId));
    setNotice(null);
    try {
      const res = await dispatchApi.startLoadingSession(orderId);
      setActiveSession(res.session);
      setEvents([]);
      setFeedback(null);
      setManualCode('');
      setOrderQuery('');
      setShowAllEvents(false);
      setLoadError(null);
      // Jump straight into scanning instead of making the user find the toggle.
      setIsCameraActive(true);
      void loadActiveState();
    } catch (err: any) {
      Alert.alert('Cannot Start Session', err?.message || 'Could not start loading session.');
      // Re-sync so an already-active session is picked up instead of dead-ending.
      void loadActiveState();
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
        // Nothing left to scan — close the camera and focus the finalise step.
        if (res.total > 0 && res.scanned >= res.total) {
          setIsCameraActive(false);
        }
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
        // Pull the latest counters so the screen switches to the finalise step.
        void loadActiveState();
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
      setNotice({
        tone: 'success',
        message: `Session finalized! Order marked as ${outcome} with Seal #${sealNumber.trim()}.`,
      });
      setActiveSession(null);
      setEvents([]);
      setFeedback(null);
      setShowAllEvents(false);
      setSealNumber('');
      setRemarks('');
      setIsCameraActive(false);
      setLoading(true);
      void loadActiveState();
    } catch (err: any) {
      Alert.alert('Finalisation Error', err?.message || 'Could not finalize loading session.');
    } finally {
      setFinalising(false);
    }
  };

  const cancelSession = async () => {
    if (!activeSession || cancelling) return;
    setCancelling(true);
    try {
      await dispatchApi.cancelLoadingSession(activeSession.id);
      setActiveSession(null);
      setEvents([]);
      setFeedback(null);
      setManualCode('');
      setShowAllEvents(false);
      setIsCameraActive(false);
      setNotice({
        tone: 'info',
        message: 'Session cancelled. Pick an approved order below to start loading again.',
      });
      setLoading(true);
      void loadActiveState();
    } catch (err: any) {
      Alert.alert('Could Not Cancel Session', err?.message || 'Please try again.');
      // The session may have moved on (e.g. a scan landed); re-sync the screen.
      void loadActiveState();
    } finally {
      setCancelling(false);
    }
  };

  const confirmCancelSession = () => {
    if (!activeSession || cancelling) return;
    Alert.alert(
      'Cancel Loading Session?',
      `No units have been scanned yet. This closes the session for ${
        activeSession.product_name || 'this product'
      } and returns the order to the approved list so you can load a different batch.`,
      [
        { text: 'Keep Loading', style: 'cancel' },
        { text: 'Cancel Session', style: 'destructive', onPress: () => void cancelSession() },
      ]
    );
  };

  const openFinaliseModal = () => {
    if (!activeSession) return;
    setFinaliseModalVisible(true);
    setSealNumber('');
    setRemarks('');
    setOutcome('DISPATCHED');
  };

  const scannedCount = activeSession?.scanned ?? 0;
  const totalCount = activeSession?.total ?? 0;
  const progressPercent =
    totalCount > 0 ? Math.min(100, Math.round((scannedCount / totalCount) * 100)) : 0;
  const remainingCount = Math.max(0, totalCount - scannedCount);
  const isComplete = totalCount > 0 && scannedCount >= totalCount;
  const canCancelSession = Boolean(activeSession) && scannedCount === 0;

  const normalizedOrderQuery = orderQuery.trim().toLowerCase();
  const filteredOrders = normalizedOrderQuery
    ? approvedOrders.filter((order) =>
        [
          order.id,
          order.product_name,
          order.batch_number,
          order.client_name,
          order.driver_name,
          order.vehicle_number,
          order.container_number,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedOrderQuery)),
      )
    : approvedOrders;
  const visibleEvents = showAllEvents ? events : events.slice(0, 15);

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

          {/* Success / info banner after finalising or cancelling a session */}
          {notice ? (
            <View
              className={`mt-4 flex-row items-center justify-between rounded-xl border p-3.5 ${
                notice.tone === 'success'
                  ? 'border-[#BBF7D0] bg-[#F0FDF4]'
                  : 'border-[#BFDBFE] bg-[#EFF6FF]'
              }`}>
              <View className="flex-1 flex-row items-center gap-2">
                {notice.tone === 'success' ? (
                  <CheckCircle2 size={18} color="#16A34A" />
                ) : (
                  <Info size={18} color="#2563EB" />
                )}
                <AppText
                  className={`flex-1 text-[12px] font-manrope-bold ${
                    notice.tone === 'success' ? 'text-[#15803D]' : 'text-[#1D4ED8]'
                  }`}>
                  {notice.message}
                </AppText>
              </View>
              <Pressable
                onPress={() => setNotice(null)}
                className="p-1"
                accessibilityRole="button"
                accessibilityLabel="Dismiss message">
                <X size={15} color={notice.tone === 'success' ? '#15803D' : '#1D4ED8'} />
              </Pressable>
            </View>
          ) : null}

          {/* Could not reach the server / load state */}
          {loadError ? (
            <View className="mt-4 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-3.5">
              <View className="flex-row items-center gap-2">
                <AlertTriangle size={17} color="#DC2626" />
                <AppText className="flex-1 text-[12px] font-manrope-bold text-[#B91C1C]">
                  {loadError}
                </AppText>
              </View>
              <Pressable
                onPress={onRefresh}
                className="mt-2.5 h-9 flex-row items-center justify-center gap-1.5 rounded-lg border border-[#FCA5A5] bg-white">
                <RefreshCw size={13} color="#B91C1C" />
                <AppText className="text-[11.5px] font-manrope-bold text-[#B91C1C]">
                  Try again
                </AppText>
              </Pressable>
            </View>
          ) : null}

          {/* Initial sync / loading after finalise or cancel */}
          {loading && !activeSession ? (
            <View className="mt-10 items-center gap-2 rounded-2xl border border-[#D4E3FA] bg-white px-6 py-10">
              <ActivityIndicator color="#011A87" size="large" />
              <AppText variant="h2" className="mt-1 text-[15px]">
                Checking for an active session…
              </AppText>
              <AppText variant="caption" className="mt-0.5 text-center text-[11px]">
                Syncing your loading status and approved orders.
              </AppText>
            </View>
          ) : activeSession ? (
            <View className="mt-5">
              {/* Active Session Info Card */}
              <View className="rounded-[18px] border border-[#CCDDF5] bg-white p-5 shadow-sm">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-2">
                    <View className="flex-row items-center gap-1.5">
                      <View
                        className={`h-1.5 w-1.5 rounded-full ${
                          isComplete ? 'bg-[#16A34A]' : 'bg-[#F59E0B]'
                        }`}
                      />
                      <AppText className="text-[10.5px] font-manrope-bold uppercase tracking-wider text-[#71829B]">
                        {isComplete ? 'Session complete' : 'Active loading session'}
                      </AppText>
                    </View>
                    <AppText
                      className="mt-1 text-[18px] text-navy"
                      style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                      {activeSession.product_name || 'Product'}
                    </AppText>
                    <View className="mt-2 flex-row flex-wrap gap-1.5">
                      <View className="rounded-full bg-[#EBF3FF] px-2.5 py-1">
                        <AppText className="text-[10px] font-manrope-bold text-navy">
                          Order #{activeSession.dispatch_order_id}
                        </AppText>
                      </View>
                      <View className="rounded-full bg-[#F0F5FD] px-2.5 py-1">
                        <AppText className="text-[10px] font-manrope-bold text-[#4E5D76]">
                          Batch {activeSession.batch_number || 'N/A'}
                        </AppText>
                      </View>
                    </View>
                  </View>
                  <StatusBadge
                    status={isComplete ? 'passed' : 'LOADING'}
                    label={isComplete ? 'COMPLETE' : 'LOADING'}
                  />
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
                    <View
                      className={`items-center rounded-xl px-3.5 py-2 ${
                        isComplete ? 'bg-[#16A34A]' : 'bg-navy'
                      }`}>
                      <AppText className="text-[16px] font-manrope-bold leading-5 text-white">
                        {progressPercent}%
                      </AppText>
                      <AppText className="text-[9px] font-manrope-medium text-white/70">complete</AppText>
                    </View>
                  </View>

                  {/* Progress Bar */}
                  <View className="mt-3 h-3 w-full overflow-hidden rounded-full bg-[#D4E3FA]">
                    <View
                      className={`h-full rounded-full ${isComplete ? 'bg-[#16A34A]' : 'bg-navy'}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </View>

                  <View className="mt-2 flex-row items-center justify-between">
                    <AppText variant="tiny" className="text-[10.5px] text-[#4E5D76]">
                      {scannedCount === 0
                        ? 'No units scanned yet'
                        : isComplete
                          ? 'All units scanned'
                          : `${remainingCount} ${remainingCount === 1 ? 'unit' : 'units'} remaining`}
                    </AppText>
                    {activeSession.started_at ? (
                      <AppText variant="tiny" className="text-[10.5px] text-[#71829B]">
                        Started {new Date(activeSession.started_at).toLocaleTimeString()}
                      </AppText>
                    ) : null}
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
                    <Pressable
                      onPress={() => setFeedback(null)}
                      hitSlop={8}
                      className="p-1"
                      accessibilityRole="button"
                      accessibilityLabel="Dismiss scan result">
                      <X
                        size={14}
                        color={
                          feedback.result === 'OK'
                            ? '#15803D'
                            : feedback.result === 'DUPLICATE'
                              ? '#B45309'
                              : '#B91C1C'
                        }
                      />
                    </Pressable>
                  </View>
                ) : null}

                {/* Scanning Interface */}
                {isComplete ? (
                  <View className="mt-5 rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
                    <View className="flex-row items-center gap-2">
                      <CheckCircle2 size={20} color="#16A34A" />
                      <AppText className="text-[13px] font-manrope-bold text-[#15803D]">
                        Batch fully loaded
                      </AppText>
                    </View>
                    <AppText className="mt-1 text-[11.5px] leading-[17px] text-[#166534]">
                      All {totalCount} units are scanned. Close the container, apply the seal and
                      finalise the dispatch below.
                    </AppText>
                  </View>
                ) : (
                  <View className="mt-5">
                    <View className="mb-2 flex-row items-center justify-between">
                      <AppText variant="label" className="text-[11px]">
                        Unit scanner
                      </AppText>
                      <AppText variant="tiny" className="text-[10px] text-[#71829B]">
                        {scanBusy ? 'Checking…' : 'Ready'}
                      </AppText>
                    </View>

                    {/* Camera View / Launch tile */}
                    {isCameraActive ? (
                      <View className="relative mb-3.5 h-[250px] w-full overflow-hidden rounded-2xl border-2 border-navy bg-black">
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
                            <AppText className="mt-2 text-center text-[12px] font-manrope-medium text-white">
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
                            <View className="h-40 w-40 rounded-2xl border-2 border-white/85" />
                            <View className="mt-3 rounded-full bg-black/65 px-3 py-1">
                              <AppText className="text-[10.5px] font-manrope-bold text-white">
                                {scanBusy ? 'Checking QR code…' : 'Align the QR label inside the box'}
                              </AppText>
                            </View>
                          </View>
                        ) : null}

                        <Pressable
                          onPress={toggleCamera}
                          accessibilityRole="button"
                          accessibilityLabel="Hide camera"
                          className="absolute right-2.5 top-2.5 h-8 w-8 items-center justify-center rounded-full bg-black/60">
                          <X size={15} color="#FFFFFF" />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        onPress={toggleCamera}
                        accessibilityRole="button"
                        accessibilityLabel="Scan units with camera"
                        className="mb-3.5 flex-row items-center gap-3 rounded-2xl border border-dashed border-[#9FBDF0] bg-[#F4F8FF] p-3.5">
                        <View className="h-11 w-11 items-center justify-center rounded-xl bg-navy">
                          <Camera size={20} color="#FFFFFF" />
                        </View>
                        <View className="flex-1">
                          <AppText className="text-[13px] font-manrope-bold text-navy">
                            Scan with camera
                          </AppText>
                          <AppText variant="tiny" className="mt-0.5 text-[10.5px] text-[#5B6B84]">
                            Auto-detects unit QR labels — no need to press a button per unit.
                          </AppText>
                        </View>
                        <ChevronDown size={16} color="#011A87" />
                      </Pressable>
                    )}

                    {/* Manual / Barcode Gun Input */}
                    <View className="flex-row items-center gap-2">
                      <View className="h-11 flex-1 flex-row items-center rounded-xl border border-line bg-white px-3">
                        <QrCode size={15} color="#8A98AC" />
                        <TextInput
                          value={manualCode}
                          onChangeText={setManualCode}
                          placeholder="Enter QR code manually"
                          placeholderTextColor="#8A98AC"
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={!scanBusy}
                          returnKeyType="done"
                          submitBehavior="submit"
                          className="ml-2 h-11 flex-1 font-manrope-medium text-[12px] text-navy"
                          onSubmitEditing={() => handleScanCode(manualCode)}
                        />
                        {manualCode.length > 0 && !scanBusy ? (
                          <Pressable
                            onPress={() => setManualCode('')}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Clear entered code">
                            <X size={14} color="#8A98AC" />
                          </Pressable>
                        ) : null}
                      </View>
                      <PrimaryButton
                        label={scanBusy ? 'Scanning…' : 'Submit'}
                        size="md"
                        disabled={!manualCode.trim() || scanBusy}
                        onPress={() => handleScanCode(manualCode)}
                      />
                    </View>

                    <AppText variant="tiny" className="mt-2 text-[10px] leading-[15px] text-[#71829B]">
                      Every label is validated against this batch: wrong-batch, duplicate or extra
                      units are flagged and never counted.
                    </AppText>
                  </View>
                )}

                {/* Finalise Dispatch / Cancel Session */}
                <View className="mt-5 border-t border-line pt-4">
                  {!isComplete && scannedCount > 0 ? (
                    <View className="mb-3 flex-row items-start gap-2 rounded-xl border border-[#FED7AA] bg-[#FFFBEB] p-3">
                      <AlertTriangle size={16} color="#D97706" />
                      <View className="flex-1">
                        <AppText className="text-[11.5px] font-manrope-bold text-[#B45309]">
                          {remainingCount} {remainingCount === 1 ? 'unit' : 'units'} still unscanned
                        </AppText>
                        <AppText className="mt-0.5 text-[10.5px] leading-[15px] text-[#92400E]">
                          Finalising now marks this as a shortfall — a reason will be required.
                        </AppText>
                      </View>
                    </View>
                  ) : null}

                  <PrimaryButton
                    label={
                      isComplete
                        ? 'Seal & Finalise Dispatch'
                        : scannedCount === 0
                          ? 'Seal & Finalise (no units scanned)'
                          : 'Finalise with Shortfall'
                    }
                    icon={ShieldCheck}
                    variant={isComplete ? 'primary' : 'outline'}
                    disabled={scanBusy || finalising}
                    onPress={openFinaliseModal}
                  />
                  <AppText variant="tiny" className="mt-2 text-center text-[10px] text-[#71829B]">
                    {isComplete
                      ? 'All units scanned. Record the seal number to close the session.'
                      : scannedCount === 0
                        ? 'You can cancel this session free of charge before the first scan.'
                        : 'Shortfall sessions are closed as DISPATCHED only after a reason is added.'}
                  </AppText>

                  {canCancelSession ? (
                    <Pressable
                      onPress={confirmCancelSession}
                      disabled={cancelling}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel loading session and choose another batch"
                      className={`mt-3.5 flex-row items-center justify-center gap-1.5 rounded-[10px] border border-[#FCA5A5] bg-[#FEF2F2] py-2.5 ${
                        cancelling ? 'opacity-60' : ''
                      }`}>
                      <Ban size={14} color="#B91C1C" />
                      <AppText className="text-[12px] font-manrope-bold text-[#B91C1C]">
                        {cancelling ? 'Cancelling session…' : 'Cancel & choose another batch'}
                      </AppText>
                    </Pressable>
                  ) : (
                    <View className="mt-3 flex-row items-start gap-1.5">
                      <Info size={12} color="#71829B" style={{ marginTop: 1 }} />
                      <AppText variant="tiny" className="flex-1 text-[10px] leading-[15px] text-[#71829B]">
                        Cancelling is no longer possible because units were already scanned. Finalise
                        this batch to close the session.
                      </AppText>
                    </View>
                  )}
                </View>
              </View>

              {/* Recent Scan History */}
              <View className="mt-6">
                <View className="mb-2.5 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5">
                    <AppText variant="label" className="text-[12px]">
                      Scan history
                    </AppText>
                    <View className="rounded-full bg-[#EBF3FF] px-2 py-0.5">
                      <AppText className="text-[9.5px] font-manrope-bold text-navy">
                        {events.length}
                      </AppText>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => void refreshEvents()}
                    disabled={refreshingEvents}
                    accessibilityRole="button"
                    accessibilityLabel="Refresh scan history"
                    hitSlop={8}
                    className={`flex-row items-center gap-1 ${refreshingEvents ? 'opacity-50' : ''}`}>
                    <RefreshCw size={12} color="#011A87" />
                    <AppText className="text-[11px] font-manrope-bold text-navy">
                      {refreshingEvents ? 'Refreshing…' : 'Refresh'}
                    </AppText>
                  </Pressable>
                </View>

                {events.length === 0 ? (
                  <View className="items-center rounded-xl border border-dashed border-line bg-white p-4">
                    <AppText variant="caption" className="text-[11px]">
                      No units scanned yet in this session.
                    </AppText>
                  </View>
                ) : (
                  <View className="gap-2">
                    {visibleEvents.map((ev, idx) => {
                      const isOk = ev.result === 'OK';
                      const isDuplicate = ev.result === 'DUPLICATE';
                      return (
                        <View
                          key={ev.id || idx}
                          className="flex-row items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5">
                          <View
                            className={`h-7 w-7 items-center justify-center rounded-full ${
                              isOk
                                ? 'bg-[#DFF7EA]'
                                : isDuplicate
                                  ? 'bg-[#FEF3C7]'
                                  : 'bg-[#FEE2E2]'
                            }`}>
                            {isOk ? (
                              <CheckCircle2 size={14} color="#16A34A" />
                            ) : isDuplicate ? (
                              <AlertTriangle size={14} color="#D97706" />
                            ) : (
                              <XCircle size={14} color="#DC2626" />
                            )}
                          </View>
                          <View className="flex-1">
                            <AppText
                              className="text-[11.5px] font-manrope-bold text-navy"
                              numberOfLines={1}>
                              {ev.qr_value}
                            </AppText>
                            <AppText variant="tiny" className="mt-0.5 text-[10px] text-[#71829B]">
                              {ev.scanned_at
                                ? new Date(ev.scanned_at).toLocaleTimeString()
                                : 'Just now'}
                            </AppText>
                          </View>
                          <StatusBadge
                            status={isOk ? 'passed' : isDuplicate ? 'pending' : 'failed'}
                            label={isOk ? 'OK' : ev.result}
                          />
                        </View>
                      );
                    })}

                    {events.length > 15 ? (
                      <Pressable
                        onPress={() => setShowAllEvents((prev) => !prev)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showAllEvents ? 'Show only latest scan events' : 'Show all scan events'
                        }
                        className="mt-1 flex-row items-center justify-center gap-1 rounded-xl border border-[#D4E3FA] bg-[#F4F8FF] py-2.5">
                        <AppText className="text-[11px] font-manrope-bold text-navy">
                          {showAllEvents
                            ? 'Show latest 15'
                            : `Show all ${events.length} events`}
                        </AppText>
                        {showAllEvents ? (
                          <ChevronUp size={14} color="#011A87" />
                        ) : (
                          <ChevronDown size={14} color="#011A87" />
                        )}
                      </Pressable>
                    ) : null}
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
                      Ready to load
                    </AppText>
                    <AppText variant="caption" className="text-[11px]">
                      Pick an approved order to open a loading session.
                    </AppText>
                  </View>
                </View>

                <View className="mt-4 flex-row gap-2">
                  {[
                    { n: '1', label: 'Choose order' },
                    { n: '2', label: 'Scan units' },
                    { n: '3', label: 'Seal & close' },
                  ].map((step) => (
                    <View
                      key={step.n}
                      className="flex-1 items-center gap-1 rounded-xl bg-canvas px-1.5 py-2">
                      <View className="h-5 w-5 items-center justify-center rounded-full bg-navy">
                        <AppText className="text-[9.5px] font-manrope-bold text-white">
                          {step.n}
                        </AppText>
                      </View>
                      <AppText variant="tiny" className="text-center text-[9.5px] text-[#4E5D76]">
                        {step.label}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>

              <View className="mt-6 flex-row items-center justify-between">
                <AppText variant="label" className="text-[12px]">
                  Ready for loading
                </AppText>
                <View className="rounded-full bg-[#EBF3FF] px-2.5 py-0.5">
                  <AppText className="text-[10px] font-manrope-bold text-navy">
                    {approvedOrders.length} approved
                  </AppText>
                </View>
              </View>

              {approvedOrders.length > 0 ? (
                <View className="mb-3 mt-2.5 flex-row items-center rounded-xl border border-line bg-white px-3">
                  <Search size={15} color="#8A98AC" />
                  <TextInput
                    value={orderQuery}
                    onChangeText={setOrderQuery}
                    placeholder="Search order, product, client or vehicle"
                    placeholderTextColor="#8A98AC"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    className="ml-2 h-11 flex-1 font-manrope-medium text-[12px] text-navy"
                    accessibilityLabel="Search approved orders"
                  />
                  {orderQuery.length > 0 ? (
                    <Pressable
                      onPress={() => setOrderQuery('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Clear order search">
                      <X size={14} color="#8A98AC" />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {loading ? (
                <View className="items-center gap-2 py-8">
                  <ActivityIndicator color="#011A87" />
                  <AppText variant="caption">Loading approved orders...</AppText>
                </View>
              ) : approvedOrders.length === 0 ? (
                <View className="items-center rounded-2xl border border-dashed border-[#CCD7E6] bg-white px-6 py-10">
                  <Package size={32} color="#9AA6B8" strokeWidth={1.5} />
                  <AppText variant="h2" className="mt-2 text-[15px]">
                    No Approved Orders
                  </AppText>
                  <AppText variant="caption" className="mt-1 text-center text-[11px]">
                    There are no QC-approved dispatch orders waiting to be loaded. Raise a new
                    request or wait for QC approval.
                  </AppText>
                </View>
              ) : filteredOrders.length === 0 ? (
                <View className="items-center rounded-2xl border border-dashed border-[#CCD7E6] bg-white px-6 py-9">
                  <Search size={28} color="#9AA6B8" strokeWidth={1.5} />
                  <AppText variant="h2" className="mt-2 text-[14px]">
                    No matching orders
                  </AppText>
                  <AppText variant="caption" className="mt-1 text-center text-[11px]">
                    Nothing matches “{orderQuery.trim()}”. Try a different order number, product or
                    client name.
                  </AppText>
                  <Pressable
                    onPress={() => setOrderQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear order search"
                    className="mt-3 rounded-lg bg-[#EBF3FF] px-3 py-1.5">
                    <AppText className="text-[11px] font-manrope-bold text-navy">Clear search</AppText>
                  </Pressable>
                </View>
              ) : (
                <View className="gap-3">
                  {filteredOrders.map((order) => {
                    const isStarting = startingOrderId === String(order.id);
                    const disabled = startingOrderId !== null;
                    return (
                      <View
                        key={order.id}
                        className={`rounded-2xl border bg-white p-4 shadow-sm ${
                          isStarting ? 'border-[#011A87]' : 'border-[#D4E3FA]'
                        }`}>
                        <View className="flex-row items-start justify-between">
                          <View className="flex-1 pr-2">
                            <AppText className="text-[10.5px] font-manrope-bold tracking-wide text-[#71829B]">
                              ORDER #{order.id}
                            </AppText>
                            <AppText
                              className="mt-0.5 text-[15px] text-navy"
                              style={{ fontFamily: 'Manrope_800ExtraBold' }}>
                              {order.product_name || 'Product'}
                            </AppText>
                            <View className="mt-2 flex-row flex-wrap gap-1.5">
                              <View className="rounded-full bg-[#F0F5FD] px-2 py-0.5">
                                <AppText className="text-[9.5px] font-manrope-bold text-[#4E5D76]">
                                  Batch {order.batch_number || 'N/A'}
                                </AppText>
                              </View>
                              <View className="rounded-full bg-[#F0F5FD] px-2 py-0.5">
                                <AppText className="text-[9.5px] font-manrope-bold text-[#4E5D76]">
                                  {order.quantity ?? '-'} {order.uom || 'units'}
                                </AppText>
                              </View>
                              {order.grade_name ? (
                                <View className="rounded-full bg-[#F0F5FD] px-2 py-0.5">
                                  <AppText className="text-[9.5px] font-manrope-bold text-[#4E5D76]">
                                    {order.grade_name}
                                  </AppText>
                                </View>
                              ) : null}
                            </View>
                          </View>
                          <StatusBadge status="APPROVED" label="APPROVED" />
                        </View>

                        <View className="mt-3 gap-1.5 rounded-xl bg-canvas p-2.5">
                          <View className="flex-row items-center gap-1.5">
                            <Package size={11} color="#71829B" />
                            <AppText variant="tiny" className="flex-1 text-[10px] text-[#71829B]">
                              Customer:{' '}
                              <AppText className="font-manrope-bold text-navy">
                                {order.client_name || 'N/A'}
                              </AppText>
                            </AppText>
                          </View>
                          <View className="flex-row items-center gap-1.5">
                            <Truck size={11} color="#71829B" />
                            <AppText variant="tiny" className="flex-1 text-[10px] text-[#71829B]">
                              {order.driver_name || 'Driver not assigned'}
                              {order.vehicle_number ? ` · ${order.vehicle_number}` : ''}
                              {order.container_number ? ` · ${order.container_number}` : ''}
                            </AppText>
                          </View>
                        </View>

                        <PrimaryButton
                          label={isStarting ? 'Starting session…' : 'Start loading session'}
                          icon={Truck}
                          size="md"
                          disabled={disabled}
                          className="mt-3"
                          onPress={() => handleStartSession(order.id)}
                        />
                      </View>
                    );
                  })}
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
        onRequestClose={() => {
          if (!finalising) setFinaliseModalVisible(false);
        }}>
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/45"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            className="flex-1"
            onPress={() => {
              if (!finalising) setFinaliseModalVisible(false);
            }}
          />
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
                onPress={() => {
                  if (!finalising) setFinaliseModalVisible(false);
                }}
                disabled={finalising}
                accessibilityRole="button"
                accessibilityLabel="Close finalise sheet"
                className="h-8 w-8 items-center justify-center rounded-full bg-canvas">
                <X size={17} color="#001A6E" />
              </Pressable>
            </View>

            <ScrollView
              className="mt-3"
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 4 }}>
              {/* Session summary */}
              {activeSession ? (
                <View className="mb-4 rounded-xl border border-[#D4E3FA] bg-[#F7FAFF] p-3">
                  <View className="flex-row items-center justify-between">
                    <AppText
                      className="flex-1 pr-2 text-[13px] text-navy"
                      style={{ fontFamily: 'Manrope_800ExtraBold' }}
                      numberOfLines={1}>
                      {activeSession.product_name || 'Product'}
                    </AppText>
                    <AppText className="text-[10.5px] font-manrope-bold text-[#71829B]">
                      Order #{activeSession.dispatch_order_id}
                    </AppText>
                  </View>
                  <View className="mt-2 flex-row flex-wrap gap-1.5">
                    <View className="rounded-full bg-white px-2 py-0.5">
                      <AppText className="text-[9.5px] font-manrope-bold text-[#4E5D76]">
                        Batch {activeSession.batch_number || 'N/A'}
                      </AppText>
                    </View>
                    <View className="rounded-full bg-white px-2 py-0.5">
                      <AppText className="text-[9.5px] font-manrope-bold text-[#4E5D76]">
                        {activeSession.scanned} / {activeSession.total} units scanned
                      </AppText>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Shortfall warning */}
              {activeSession && activeSession.scanned < activeSession.total ? (
                <View className="mb-4 flex-row items-start gap-2 rounded-xl border border-[#FED7AA] bg-[#FFFBEB] p-3">
                  <AlertTriangle size={17} color="#D97706" />
                  <View className="flex-1">
                    <AppText className="text-[12px] font-manrope-bold text-[#B45309]">
                      Shortfall: {activeSession.total - activeSession.scanned} unit
                      {activeSession.total - activeSession.scanned === 1 ? '' : 's'} not scanned
                    </AppText>
                    <AppText className="mt-0.5 text-[11px] leading-[16px] text-[#92400E]">
                      A remark is required before this session can be closed with a shortfall.
                    </AppText>
                  </View>
                </View>
              ) : null}

              {/* Seal Number input */}
              <AppText variant="label" className="mb-1 text-[11px]">
                Tamper-evident seal number *
              </AppText>
              <TextInput
                value={sealNumber}
                onChangeText={setSealNumber}
                placeholder="e.g. SEAL-88492"
                placeholderTextColor="#8A98AC"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                accessibilityLabel="Tamper-evident seal number"
                className="mb-1.5 h-11 rounded-xl border border-line bg-white px-3.5 font-manrope-medium text-[13px] text-navy"
              />
              <AppText variant="tiny" className="mb-4 text-[10px] text-[#71829B]">
                Type the number printed on the physical seal applied to the container.
              </AppText>

              {/* Outcome Selection */}
              <AppText variant="label" className="mb-1 text-[11px]">
                Mark outcome *
              </AppText>
              <View className="mb-1.5 flex-row gap-2.5">
                <Pressable
                  onPress={() => setOutcome('DISPATCHED')}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: outcome === 'DISPATCHED' }}
                  accessibilityLabel="Mark batch as dispatched"
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
                        : 'font-manrope-medium text-[#4E5D76]'
                    }`}>
                    Dispatched
                  </AppText>
                </Pressable>

                <Pressable
                  onPress={() => setOutcome('NOT_DISPATCHED')}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: outcome === 'NOT_DISPATCHED' }}
                  accessibilityLabel="Mark batch as not dispatched"
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
                        : 'font-manrope-medium text-[#4E5D76]'
                    }`}>
                    Not dispatched
                  </AppText>
                </Pressable>
              </View>
              <AppText variant="tiny" className="mb-4 text-[10px] leading-[15px] text-[#71829B]">
                {outcome === 'DISPATCHED'
                  ? 'Scanned units are deducted from stock and the order is closed as dispatched.'
                  : 'No stock movement — the order is closed as not dispatched and needs a remark.'}
              </AppText>

              {/* Remarks */}
              <AppText variant="label" className="mb-1 text-[11px]">
                Remarks{' '}
                {activeSession &&
                (activeSession.scanned < activeSession.total || outcome === 'NOT_DISPATCHED')
                  ? '*'
                  : '(optional)'}
              </AppText>
              <TextInput
                value={remarks}
                onChangeText={setRemarks}
                placeholder={
                  outcome === 'NOT_DISPATCHED'
                    ? 'Explain why this batch was not dispatched…'
                    : 'Reason for shortfall, carrier notes, or exception…'
                }
                placeholderTextColor="#8A98AC"
                multiline
                numberOfLines={3}
                accessibilityLabel="Remarks"
                className="mb-5 rounded-xl border border-line bg-white p-3 font-manrope-medium text-[12px] text-navy"
                style={{ height: 78, textAlignVertical: 'top' }}
              />

              <PrimaryButton
                label={
                  finalising
                    ? 'Finalising session…'
                    : outcome === 'DISPATCHED'
                      ? 'Confirm & finalise dispatch'
                      : 'Confirm & close as not dispatched'
                }
                disabled={finalising || !sealNumber.trim()}
                icon={ShieldCheck}
                onPress={handleFinaliseSubmit}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
