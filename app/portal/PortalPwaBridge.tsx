"use client";

import { Download, RefreshCw, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import styles from "./PortalPwaBridge.module.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PortalPwaBridge() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let mounted = true;
    let reloading = false;
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        if (!mounted) return;
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller && mounted) setWaitingWorker(worker);
          });
        });
        await registration.update();
      } catch {
        // The portal remains fully usable in the browser if service workers are unavailable.
      }
    };

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      if (mounted) setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    const controllerChanged = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    void register();
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
    return () => {
      mounted = false;
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  };

  const update = () => {
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    setWaitingWorker(null);
  };

  if (dismissed || (!installPrompt && !waitingWorker)) return null;

  const isUpdate = Boolean(waitingWorker);
  return (
    <aside className={styles.prompt} role="status" aria-label={isUpdate ? "Có phiên bản mới" : "Cài không gian vận hành"}>
      <Image src="/pwa-icon-192.png" width={40} height={40} alt="" unoptimized />
      <div>
        <strong>{isUpdate ? "Có phiên bản Tào Phớ 88 mới" : "Cài Tào Phớ 88 OS"}</strong>
        <small>{isUpdate ? "Cập nhật để mọi điện thoại dùng cùng giao diện." : "Mở không gian làm việc như một ứng dụng."}</small>
      </div>
      <button className={styles.primary} type="button" onClick={isUpdate ? update : install}>
        {isUpdate ? <RefreshCw size={16} /> : <Download size={16} />}
        {isUpdate ? "Cập nhật" : "Cài app"}
      </button>
      <button className={styles.close} type="button" aria-label="Để sau" onClick={() => setDismissed(true)}>
        <X size={17} />
      </button>
    </aside>
  );
}
