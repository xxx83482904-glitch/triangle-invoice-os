"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, Smartphone } from "lucide-react";
import { api } from "@/lib/api";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function MobileInstall() {
  const [mobileUrl, setMobileUrl] = useState<string | null>(null);
  const [access, setAccess] = useState<"private" | "public">("private");
  const [loaded, setLoaded] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let active = true;
    api<{ mobile_url: string | null; mobile_access: "private" | "public" }>("/device").then(data => {
      if (active) { setMobileUrl(data.mobile_url); setAccess(data.mobile_access); setLoaded(true); }
    }).catch(() => { if (active) setFeedback("接続先の情報を取得できませんでした。もう一度設定を開いてください。"); });
    const standalone = window.matchMedia("(display-mode: standalone)");
    const update = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const offered = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const added = () => { setInstalled(true); setPrompt(null); };
    update();
    standalone.addEventListener("change", update);
    window.addEventListener("beforeinstallprompt", offered);
    window.addEventListener("appinstalled", added);
    return () => {
      active = false;
      standalone.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", offered);
      window.removeEventListener("appinstalled", added);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setFeedback(choice.outcome === "accepted" ? "追加後、ホーム画面の「こもれび」を開いてください。" : "あとからブラウザのメニューで追加できます。");
    } catch { setFeedback("ブラウザのメニューから「ホーム画面に追加」を選んでください。"); }
    setPrompt(null);
  }

  return <article className="settings-card mobile-install">
    <div className="card-heading"><Smartphone size={21}/><h2>携帯でアプリとして使う</h2>{installed && <span className="soft-tag"><Check size={13}/> アプリ表示中</span>}</div>
    <p>ホーム画面の「こもれび」から会話を開き、メッセージを送れます。{access === "public" ? "携帯のVPN接続は不要です。Windowsは起動したままにしてください。" : "Windowsは起動したまま、携帯では同じTailscaleに接続してください。"}</p>
    {mobileUrl ? <div className="mobile-address"><span>携帯用の接続先</span><a href={mobileUrl}>{mobileUrl}</a><button className="secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(mobileUrl); setFeedback("接続先をコピーしました。"); }
      catch { setFeedback("上の接続先を長押ししてコピーしてください。"); }
    }}><Copy size={14}/>接続先をコピー</button></div> : loaded && <p className="help">携帯用の接続先は未設定です。Windowsで携帯からの接続を設定すると、ここに表示されます。</p>}
    {access === "public" && <p className="help">ログイン画面はインターネットから開けます。会話の閲覧・送信には接続キーでのログインが必要です。接続キーは共有しないでください。</p>}
    {installed ? <p className="help">ホーム画面から起動しています。会話一覧で相手を選び、入力欄から送信してください。</p> : <>
      {prompt && <button className="secondary" onClick={install}><Download size={16}/>こもれびをインストール</button>}
      <ol className="install-steps">
        <li>{access === "public" ? "携帯のSafariまたはChromeで、上の接続先を開きます。" : "携帯でTailscaleに接続し、上の接続先を開きます。"}</li>
        <li><strong>iPhone：</strong>Safariの共有メニュー →「ホーム画面に追加」。表示される場合は「Webアプリとして開く」をオンにします。</li>
        <li><strong>Android：</strong>Chromeのメニュー →「アプリをインストール」または「ホーム画面に追加」。</li>
        <li>追加した「こもれび」を開き、このアプリの接続キーを入力します。WeChatのパスワードは使いません。</li>
      </ol>
    </>}
    {feedback && <p className="help" role="status">{feedback}</p>}
    <p className="help">画面を閉じている間の通知は未対応です。Windowsのスリープ・電源オフ中は接続できません。Mock表示中の送信はサンプル会話だけに反映されます。</p>
  </article>;
}
