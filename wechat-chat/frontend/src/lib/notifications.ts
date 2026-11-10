"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export type IncomingNotice = { id: number; chat_id: string; message_id: number; created_at: string };
type Feed = { cursor: number; events: IncomingNotice[] };
type PushStatus = { enabled: boolean; public_key: string | null };
const SOUND = "komorebi-sound";
const PUSH = "komorebi-push";

function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(text, c => c.charCodeAt(0));
}

export function useChatNotifications(ready: boolean, onOpen: (id: string) => void, isReading: (id: string) => boolean) {
  const [sound, setSound] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [push, setPush] = useState(false);
  const [supported, setSupported] = useState(false);
  const [server, setServer] = useState<PushStatus | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unavailable">("unavailable");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState<IncomingNotice | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const options = useRef({ready, onOpen, isReading, sound});
  options.current = {ready, onOpen, isReading, sound};
  const cursor = useRef<number | null>(null);
  const fetching = useRef(false);
  const generation = useRef(0);

  const unlockAudio = useCallback(async () => {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSoundReady(audio.current.state === "running");
      return audio.current.state === "running";
    } catch { setSoundReady(false); return false; }
  }, []);

  const chime = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== "running") { setSoundReady(false); return; }
    const start = context.currentTime;
    [660, 880].forEach((frequency, i) => {
      const tone = context.createOscillator(), volume = context.createGain();
      tone.type = "sine"; tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0, start + i * .13);
      volume.gain.linearRampToValueAtTime(.075, start + i * .13 + .015);
      volume.gain.exponentialRampToValueAtTime(.001, start + i * .13 + .2);
      tone.connect(volume); volume.connect(context.destination);
      tone.start(start + i * .13); tone.stop(start + i * .13 + .21);
    });
  }, []);

  const receive = useCallback(async () => {
    if (!options.current.ready || fetching.current) return;
    fetching.current = true;
    const currentGeneration = generation.current;
    try {
      const feed = await api<Feed>(`/notifications/events${cursor.current === null ? "" : `?after=${cursor.current}`}`);
      if (currentGeneration !== generation.current || !options.current.ready) return;
      cursor.current = feed.cursor;
      const recent = feed.events.filter(event => Date.now() - Date.parse(event.created_at) < 120000);
      const latest = recent.filter(event => !options.current.isReading(event.chat_id)).at(-1);
      if (!latest || document.visibilityState !== "visible" || !document.hasFocus()) return;
      setNotice(latest);
      const playOnce = () => {
        const key = `${latest.chat_id}:${latest.id}:${latest.created_at}`;
        let seen: string[] = [];
        try { seen = JSON.parse(localStorage.getItem("komorebi-notified") || "[]"); } catch { /* no private payload stored */ }
        if (seen.includes(key)) return;
        localStorage.setItem("komorebi-notified", JSON.stringify([...seen.slice(-49), key]));
        if (options.current.sound) chime();
      };
      if (navigator.locks) await navigator.locks.request("komorebi-notification", playOnce);
      else playOnce();
    } catch { /* Connectivity is shown by the chat's existing connection indicator. */ }
    finally { fetching.current = false; }
  }, [chime]);

  useEffect(() => {
    setSound(localStorage.getItem(SOUND) === "true");
    setSupported(isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    if ("Notification" in window) setPermission(Notification.permission);
    return () => { void audio.current?.close(); audio.current = null; };
  }, []);

  useEffect(() => {
    generation.current++;
    cursor.current = null;
    if (!ready) { setNotice(null); return; }
    let cancelled = false;
    void receive();
    // These contain only opaque IDs. Reconnect/polling cannot replay imports.
    const interval = setInterval(() => void receive(), 10000);
    const visibility = () => { if (!document.hidden) void receive(); };
    const unlock = () => { if (options.current.sound) void unlockAudio(); };
    const refreshSettings = async () => {
      try {
        const config = await api<PushStatus>("/notifications/status");
        if (cancelled) return;
        setServer(config);
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        if (cancelled) return;
        setPush(!!existing && localStorage.getItem(PUSH) === "true");
        // Refresh ownership after the owner's normal app login; no permission
        // prompt or new browser subscription is created in this effect.
        if (existing && config.enabled && localStorage.getItem(PUSH) === "true") {
          await api("/notifications/subscribe", {...existing.toJSON(), consent:true});
        }
      } catch { if (!cancelled) setFeedback("通知の設定を確認できません。接続が戻ってから設定を開き直してください。"); }
    };
    void refreshSettings();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", unlock);
    return () => {
      cancelled = true; generation.current++; clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", unlock);
    };
  }, [ready, receive, unlockAudio]);

  useEffect(() => {
    const openMessage = (event: MessageEvent) => {
      if (event.data?.type !== "open-chat" || !/^[a-f0-9-]{36}$/.test(event.data.chat_id || "")) return;
      options.current.onOpen(event.data.chat_id);
      event.ports[0]?.postMessage({opened:true});
    };
    navigator.serviceWorker?.addEventListener("message", openMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", openMessage);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 10000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function toggleSound() {
    if (sound) { setSound(false); localStorage.setItem(SOUND, "false"); return; }
    const available = await unlockAudio();
    if (!available) { setFeedback("音を有効にできませんでした。この画面でもう一度操作してください。"); return; }
    setSound(true); localStorage.setItem(SOUND, "true"); chime();
  }

  async function enablePush() {
    if (!supported || !server?.enabled || !server.public_key || busy) return;
    setBusy(true); setFeedback("");
    try {
      // Must start directly in the owner's button handler (required on iOS).
      const granted = await Notification.requestPermission(); setPermission(granted);
      if (granted !== "granted") { setFeedback("通知は許可されていません。端末の設定から変更できます。"); return; }
      await navigator.serviceWorker.register("/sw.js", {updateViaCache:"none"});
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const created = !subscription;
      subscription ??= await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:applicationKey(server.public_key)});
      try { await api("/notifications/subscribe", {...subscription.toJSON(), consent:true}); }
      catch (error) { if (created) await subscription.unsubscribe(); throw error; }
      localStorage.setItem(PUSH, "true"); setPush(true);
      setFeedback("この端末への通知をオンにしました。「通知をテスト」で受信を確認できます。");
    } catch { setFeedback("通知を登録できませんでした。iPhoneはホーム画面から開き、通信と通知の許可を確認してください。"); }
    finally { setBusy(false); }
  }

  async function disablePush() {
    setBusy(true); setFeedback("");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) { await api("/notifications/unsubscribe", {endpoint:subscription.endpoint}); await subscription.unsubscribe(); }
      localStorage.removeItem(PUSH); setPush(false); setFeedback("この端末への通知をオフにしました。");
      (await registration?.getNotifications())?.forEach(n => n.close());
    } catch { setFeedback("通知の停止を確認できません。接続が戻ったら、もう一度オフにしてください。"); }
    finally { setBusy(false); }
  }

  async function testPush() {
    setBusy(true); setFeedback("");
    try {
      const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (!subscription) throw Error();
      const result = await api<{status:string}>("/notifications/test", {endpoint:subscription.endpoint});
      setFeedback(result.status === "accepted" ? "通知サービスが受け付けました。端末にテスト通知が届くか確認してください。" : "通知サービスへ届けられませんでした。通知をオフ・オンして登録を更新してください。");
    } catch { setFeedback("テスト通知を送れませんでした。接続状態を確認してください。"); }
    finally { setBusy(false); }
  }

  async function logout() {
    localStorage.removeItem(PUSH); setPush(false); setNotice(null);
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      (await registration?.getNotifications())?.forEach(n => n.close());
    } catch { /* Server logout has already revoked this session's subscription. */ }
  }

  return {sound, soundReady, push, supported, server, permission, busy, feedback, notice,
    receive, toggleSound, enablePush, disablePush, testPush, logout,
    dismiss:() => setNotice(null), open:() => { if (notice) onOpen(notice.chat_id); setNotice(null); }};
}

export type ChatNotifications = ReturnType<typeof useChatNotifications>;
