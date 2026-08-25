import type { OrderController } from "./controller";
import GroupSetupSheet from "./sheets/GroupSetupSheet";
import GroupShareSheet from "./sheets/GroupShareSheet";
import LocationSheet from "./sheets/LocationSheet";
import FilterSheet from "./sheets/FilterSheet";
import FavoritesSheet from "./sheets/FavoritesSheet";
import StoreDetailsSheet from "./sheets/StoreDetailsSheet";
import ProductDetailsSheet from "./sheets/ProductDetailsSheet";
import CartDecisionSheet from "./sheets/CartDecisionSheet";
import CheckoutSheet from "./sheets/CheckoutSheet";
import NotificationsSheet from "./sheets/NotificationsSheet";
import AuthSheet from "./sheets/AuthSheet";
import AccountServiceSheet from "./sheets/AccountServiceSheet";
import ProfileEditorSheet from "./sheets/ProfileEditorSheet";
import SupportChatSheet from "./sheets/SupportChatSheet";
import AffiliateApplicationSheet from "./sheets/AffiliateApplicationSheet";
import NearbyActionsSheet from "./sheets/NearbyActionsSheet";
import StorePreorderSheet from "./sheets/StorePreorderSheet";
import PartnerApplicationSheet from "./sheets/PartnerApplicationSheet";
import AffiliateShareSheet from "./sheets/AffiliateShareSheet";
import RevenueDetailsSheet from "./sheets/RevenueDetailsSheet";
import OrderSuccessSheet from "./sheets/OrderSuccessSheet";
import ToastMessage from "./sheets/ToastMessage";

type OrderOverlaysProps = { model: OrderController };

export default function OrderOverlays({ model }: OrderOverlaysProps) {
  return (
    <>
      <GroupSetupSheet model={model} />
      <GroupShareSheet model={model} />
      <LocationSheet model={model} />
      <FilterSheet model={model} />
      <FavoritesSheet model={model} />
      <StoreDetailsSheet model={model} />
      <ProductDetailsSheet model={model} />
      <CartDecisionSheet model={model} />
      <CheckoutSheet model={model} />
      <NotificationsSheet model={model} />
      <AuthSheet model={model} />
      <AccountServiceSheet model={model} />
      <ProfileEditorSheet model={model} />
      <SupportChatSheet model={model} />
      <AffiliateApplicationSheet model={model} />
      <NearbyActionsSheet model={model} />
      <StorePreorderSheet model={model} />
      <PartnerApplicationSheet model={model} />
      <AffiliateShareSheet model={model} />
      <RevenueDetailsSheet model={model} />
      <OrderSuccessSheet model={model} />
      <ToastMessage model={model} />
    </>
  );
}
