"use client";

import { Download, RefreshCw, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./customer.module.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    let registration: ServiceWorkerRegistration | null = null;
    let updateFoundHandler: (() => void) | null = null;
    const reloadOnControllerChange = Boolean(navigator.serviceWorker?.controller);

    const controllerChangeHandler = () => {
      if (!reloadOnControllerChange || reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", controllerChangeHandler);
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((nextRegistration) => {
          registration = nextRegistration;

          const offerWaitingUpdate = () => {
            if (nextRegistration.waiting && navigator.serviceWorker.controller) {
              setUpdateWorker(nextRegistration.waiting);
              setVisible(true);
            }
          };

          const watchInstallingWorker = () => {
            const installing = nextRegistration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed") offerWaitingUpdate();
            });
          };

          updateFoundHandler = watchInstallingWorker;
          nextRegistration.addEventListener("updatefound", watchInstallingWorker);
          offerWaitingUpdate();
          return nextRegistration.update();
        })
        .catch(() => undefined);
    }

    const standalone = window.matchMedia("(display-mode: standalone)").matches;

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setVisible(false);
    };

    if (!standalone) window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
      navigator.serviceWorker?.removeEventListener("controllerchange", controllerChangeHandler);
      if (registration && updateFoundHandler) registration.removeEventListener("updatefound", updateFoundHandler);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setVisible(false);
      setInstallPrompt(null);
    }
  };

  const update = () => {
    if (!updateWorker || updating) return;
    setUpdating(true);
    updateWorker.postMessage({ type: "SKIP_WAITING" });
  };

  if (!visible || (!installPrompt && !updateWorker)) return null;

  const isUpdate = Boolean(updateWorker);

  return (
    <aside className={styles.installPrompt} aria-label={isUpdate ? "Cập nhật ứng dụng Tào Phớ 88" : "Cài ứng dụng Tào Phớ 88"} role="status">
      <Image src="/pwa-icon-192.png" width={44} height={44} alt="" unoptimized />
      <div>
        <strong>{isUpdate ? "Tào Phớ 88 có bản mới" : "Cài Tào Phớ 88"}</strong>
        <small>{isUpdate ? "Cập nhật giao diện mới và giữ nguyên giỏ hàng" : "Mở nhanh như một ứng dụng trên điện thoại"}</small>
      </div>
      <button type="button" onClick={isUpdate ? update : install} disabled={updating} data-install-pwa={!isUpdate || undefined} data-update-pwa={isUpdate || undefined}>
        {isUpdate ? <RefreshCw size={16} /> : <Download size={16} />} {updating ? "Đang cập nhật" : isUpdate ? "Cập nhật" : "Cài"}
      </button>
      <button className={styles.installClose} type="button" aria-label="Để sau" onClick={() => setVisible(false)}>
        <X size={15} />
      </button>
    </aside>
  );
}
