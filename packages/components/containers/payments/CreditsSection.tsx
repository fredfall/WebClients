import { c } from 'ttag';

import { Button } from '@proton/atoms';
import { isFreeSubscription } from '@proton/shared/lib/constants';
import { getHasVpnB2BPlan, isManagedExternally } from '@proton/shared/lib/helpers/subscription';
import { BillingPlatform, ChargebeeEnabled } from '@proton/shared/lib/interfaces';

import { Loader, Price, useModalTwoStatic } from '../../components';
import { useModalState } from '../../components/modalTwo';
import { useSubscription, useUser } from '../../hooks';
import { SettingsParagraph, SettingsSection } from '../account';
import CreditsModal from './CreditsModal';
import InAppPurchaseModal from './subscription/InAppPurchaseModal';

const CreditsSection = () => {
    const [subscription] = useSubscription();
    const [creditModalProps, setCreditModalOpen, renderCreditModal] = useModalState();
    const [externalSubscriptionModal, showExternalSubscriptionModal] = useModalTwoStatic(InAppPurchaseModal);

    const [{ Credit, Currency, ChargebeeUser }] = useUser();

    if (!subscription) {
        return <Loader />;
    }

    let upcomingSubscriptionPrice: number = 0;
    // In case of Chargebee, they don't display the balance for the upcoming subscription.
    // Instead, they count it as already paid, and they return credits balance already taking into account
    // the upcoming subscription.
    if (
        !isFreeSubscription(subscription) &&
        subscription?.BillingPlatform !== BillingPlatform.Chargebee &&
        subscription?.UpcomingSubscription
    ) {
        upcomingSubscriptionPrice =
            subscription.UpcomingSubscription.Amount - subscription.UpcomingSubscription.Discount;
    }

    let availableCredits = Credit - upcomingSubscriptionPrice;
    if (availableCredits < 0) {
        availableCredits = 0;
    }

    const hasVpnB2B = getHasVpnB2BPlan(subscription);

    return (
        <SettingsSection>
            <SettingsParagraph>
                {c('Info')
                    .t`When your subscription renews, we will apply any available credits before we charge the payment method above.`}
            </SettingsParagraph>
            {hasVpnB2B ? null : (
                <div className="mb-7">
                    <Button
                        shape="outline"
                        onClick={() => {
                            if (isManagedExternally(subscription)) {
                                showExternalSubscriptionModal({
                                    subscription,
                                });
                                return;
                            }

                            setCreditModalOpen(true);
                        }}
                    >{c('Action').t`Add credits`}</Button>
                </div>
            )}
            <div className="px-4 mb-4 flex justify-space-between">
                <span className="text-bold" data-testid="unused-credits">{c('Credits').t`Available credits`}</span>
                <span className="text-bold" data-testid="avalaible-credits">
                    {ChargebeeUser === ChargebeeEnabled.CHARGEBEE_FORCED ? (
                        <Price currency={Currency}>{availableCredits}</Price>
                    ) : (
                        availableCredits / 100
                    )}
                </span>
            </div>
            <hr />
            {renderCreditModal && <CreditsModal {...creditModalProps} />}
            {externalSubscriptionModal}
        </SettingsSection>
    );
};

export default CreditsSection;
