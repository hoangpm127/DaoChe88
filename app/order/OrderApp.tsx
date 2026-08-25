"use client";

import PwaInstallPrompt from "./PwaInstallPrompt";
import styles from "./customer.module.css";
import { useOrderController } from "./controller";
import OrderOverlays from "./OrderOverlays";
import OrderShell from "./OrderShell";

export default function OrderApp() {
  const model = useOrderController();
  return (
    <div className={styles.customerStage}>
      <OrderShell model={model} />
      <OrderOverlays model={model} />
      <PwaInstallPrompt />
    </div>
  );
}
