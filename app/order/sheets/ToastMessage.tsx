import { CheckCircle2 } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type ToastMessageProps = { model: OrderController };

export default function ToastMessage({ model }: ToastMessageProps) {
  const { toast } = model;
  return (toast && (
        <div className={styles.toast} role="status">
          <CheckCircle2 size={17} /> {toast}
        </div>
      ));
}
