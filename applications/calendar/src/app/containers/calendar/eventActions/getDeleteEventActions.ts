import { getIsCalendarDisabled } from '@proton/shared/lib/calendar/calendar';
import getMemberAndAddress from '@proton/shared/lib/calendar/integration/getMemberAndAddress';
import { getSelfAttendeeToken } from '@proton/shared/lib/calendar/integration/invite';
import { getSharedEventIDAndSessionKey } from '@proton/shared/lib/calendar/veventHelper';
import { noop } from '@proton/shared/lib/helpers/function';
import { Address, Api } from '@proton/shared/lib/interfaces';
import { CalendarBootstrap, CalendarEvent, VcalVeventComponent } from '@proton/shared/lib/interfaces/calendar';
import { DELETE_CONFIRMATION_TYPES } from '@proton/shared/lib/calendar/constants';
import { useGetCalendarKeys } from '@proton/components';

import { getEventDeletedText, getRecurringEventDeletedText } from '../../../components/eventModal/eventForm/i18n';
import { EventOldData } from '../../../interfaces/EventData';
import {
    INVITE_ACTION_TYPES,
    InviteActions,
    SendIcsActionData,
    UpdatePartstatOperation,
    UpdatePersonalPartOperation,
} from '../../../interfaces/Invite';
import getEditEventData from '../event/getEditEventData';
import getSingleEditRecurringData from '../event/getSingleEditRecurringData';
import { getIsCalendarEvent } from '../eventStore/cache/helper';
import { GetDecryptedEventCb } from '../eventStore/interface';
import getAllEventsByUID from '../getAllEventsByUID';
import { getDeleteSyncOperation, SyncEventActionOperations } from '../getSyncMultipleEventsPayload';
import { CalendarViewEvent, OnDeleteConfirmationCb } from '../interface';
import { getUpdatePartstatOperation } from './getChangePartstatActions';
import { getDeleteRecurringEventActions } from './getDeleteRecurringEventActions';
import getRecurringDeleteType from './getRecurringDeleteType';
import { getUpdatedDeleteInviteActions } from './inviteActions';
import { getOriginalEvent } from './recurringHelper';

const { DECLINE_INVITATION, DECLINE_DISABLED, CANCEL_INVITATION, CANCEL_DISABLED } = INVITE_ACTION_TYPES;

const getDeleteSingleEventActionsHelper = async ({
    oldEventData,
    oldEditEventData,
    onDeleteConfirmation,
    inviteActions,
    isInvitation,
    sendIcs,
}: {
    oldEventData: CalendarEvent;
    oldEditEventData: EventOldData;
    onDeleteConfirmation: OnDeleteConfirmationCb;
    inviteActions: InviteActions;
    isInvitation: boolean;
    sendIcs: (
        data: SendIcsActionData
    ) => Promise<{ veventComponent?: VcalVeventComponent; inviteActions: InviteActions; timestamp: number }>;
}) => {
    const { veventComponent: oldVevent, memberID, calendarID, addressID } = oldEditEventData;
    let updatedInviteActions = getUpdatedDeleteInviteActions({
        inviteActions,
        oldVevent,
    });
    const updatePartstatOperations: UpdatePartstatOperation[] = [];
    const { type: inviteType, sendCancellationNotice } = updatedInviteActions;
    await onDeleteConfirmation({
        type: DELETE_CONFIRMATION_TYPES.SINGLE,
        inviteActions: updatedInviteActions,
        isInvitation,
    });
    if (inviteType === CANCEL_INVITATION) {
        const { inviteActions: cleanInviteActions } = await sendIcs({
            inviteActions: updatedInviteActions,
            cancelVevent: oldVevent,
        });
        updatedInviteActions = cleanInviteActions;
    } else if (inviteType === DECLINE_INVITATION && sendCancellationNotice && oldVevent) {
        const { inviteActions: cleanInviteActions, timestamp } = await sendIcs({
            inviteActions: updatedInviteActions,
            vevent: oldVevent,
        });
        updatedInviteActions = cleanInviteActions;
        // even though we are going to delete the event, we need to update the partstat firs to notify the organizer for
        // Proton-Proton invites. Hopefully a better API will allow us to do it differently in the future
        const updatePartstatOperation = getUpdatePartstatOperation({
            eventComponent: oldVevent,
            event: oldEventData,
            memberID,
            timestamp,
            inviteActions: updatedInviteActions,
        });
        if (updatePartstatOperation) {
            updatePartstatOperations.push(updatePartstatOperation);
        }
    }
    const deleteOperation = getDeleteSyncOperation(oldEventData);
    const multiActions: SyncEventActionOperations[] = [
        {
            calendarID,
            memberID,
            addressID,
            operations: [deleteOperation],
        },
    ];
    const successText = getEventDeletedText(updatedInviteActions);
    return {
        syncActions: multiActions,
        updatePartstatActions: updatePartstatOperations,
        texts: { success: successText },
    };
};

interface Arguments {
    targetEvent: CalendarViewEvent;
    addresses: Address[];
    onDeleteConfirmation: OnDeleteConfirmationCb;
    api: Api;
    getCalendarBootstrap: (CalendarID: string) => CalendarBootstrap;
    getCalendarKeys: ReturnType<typeof useGetCalendarKeys>;
    getEventDecrypted: GetDecryptedEventCb;
    inviteActions: InviteActions;
    sendIcs: (
        data: SendIcsActionData
    ) => Promise<{ veventComponent?: VcalVeventComponent; inviteActions: InviteActions; timestamp: number }>;
}

const getDeleteEventActions = async ({
    targetEvent: {
        data: { eventData: oldEventData, calendarData: oldCalendarData, eventRecurrence, eventReadResult },
    },
    addresses,
    onDeleteConfirmation,
    api,
    getEventDecrypted,
    getCalendarBootstrap,
    getCalendarKeys,
    inviteActions,
    sendIcs,
}: Arguments): Promise<{
    syncActions: SyncEventActionOperations[];
    updatePartstatActions?: UpdatePartstatOperation[];
    updatePersonalPartActions?: UpdatePersonalPartOperation[];
    texts: { success: string };
}> => {
    const calendarBootstrap = getCalendarBootstrap(oldCalendarData.ID);
    if (!calendarBootstrap) {
        throw new Error('Trying to delete event without calendar information');
    }
    if (!oldEventData || !getIsCalendarEvent(oldEventData)) {
        throw new Error('Trying to delete event without event information');
    }

    const oldEditEventData = getEditEventData({
        eventData: oldEventData,
        eventResult: eventReadResult?.result,
        memberResult: getMemberAndAddress(addresses, calendarBootstrap.Members, oldEventData.Author),
    });
    const { sharedEventID, sharedSessionKey } = await getSharedEventIDAndSessionKey({
        calendarEvent: oldEventData,
        getCalendarKeys,
    });
    const inviteActionsWithSharedData = {
        ...inviteActions,
        sharedEventID,
        sharedSessionKey,
    };

    const isInvitation = !oldEditEventData.eventData.IsOrganizer;
    const isSingleEdit = !!oldEditEventData.recurrenceID;
    // If it's not an occurrence of a recurring event, or a single edit of a recurring event
    if (!eventRecurrence && !isSingleEdit) {
        return getDeleteSingleEventActionsHelper({
            oldEventData,
            oldEditEventData,
            onDeleteConfirmation,
            inviteActions: inviteActionsWithSharedData,
            isInvitation,
            sendIcs,
        });
    }

    const recurrences = await getAllEventsByUID(api, oldEditEventData.calendarID, oldEditEventData.uid);
    const originalEventData = getOriginalEvent(recurrences);
    const isOrphanSingleEdit = isSingleEdit && !originalEventData;
    // If it's an orphan single edit, treat as a single event
    if (isOrphanSingleEdit) {
        return getDeleteSingleEventActionsHelper({
            oldEventData,
            oldEditEventData,
            onDeleteConfirmation,
            inviteActions: inviteActionsWithSharedData,
            isInvitation,
            sendIcs,
        });
    }

    let originalEditEventData = oldEditEventData;

    // If this is a single edit, get the original event data
    if (originalEventData && originalEventData.ID !== oldEventData.ID) {
        const originalEventResult = await getEventDecrypted(originalEventData).catch(noop);

        originalEditEventData = getEditEventData({
            eventData: originalEventData,
            eventResult: originalEventResult,
            memberResult: getMemberAndAddress(addresses, calendarBootstrap.Members, originalEventData.Author),
        });
    }

    const actualEventRecurrence =
        eventRecurrence ||
        getSingleEditRecurringData(originalEditEventData.mainVeventComponent, oldEditEventData.mainVeventComponent);
    const updatedDeleteInviteActions = getUpdatedDeleteInviteActions({
        inviteActions: inviteActionsWithSharedData,
        oldVevent: originalEditEventData.veventComponent,
    });
    const isDeleteInvitation = [DECLINE_INVITATION, DECLINE_DISABLED].includes(updatedDeleteInviteActions.type);
    const isCancelInvitation = [CANCEL_INVITATION, CANCEL_DISABLED].includes(updatedDeleteInviteActions.type);
    const selfAttendeeToken = getSelfAttendeeToken(originalEditEventData.veventComponent, addresses);
    const isCalendarDisabled = getIsCalendarDisabled(oldCalendarData);

    const { type: deleteType, inviteActions: updatedInviteActions } = await getRecurringDeleteType({
        originalEditEventData,
        canOnlyDeleteAll:
            !originalEditEventData.veventComponent ||
            !oldEditEventData.veventComponent ||
            isCalendarDisabled ||
            actualEventRecurrence.isSingleOccurrence ||
            isCancelInvitation ||
            (isDeleteInvitation && !isSingleEdit),
        canOnlyDeleteThis: isDeleteInvitation && isSingleEdit,
        onDeleteConfirmation,
        recurrences,
        recurrence: actualEventRecurrence,
        inviteActions: updatedDeleteInviteActions,
        isCalendarDisabled,
        isInvitation,
        selfAttendeeToken,
    });
    const {
        multiSyncActions,
        inviteActions: deleteInviteActions,
        updatePartstatActions,
        updatePersonalPartActions,
    } = await getDeleteRecurringEventActions({
        type: deleteType,
        recurrence: actualEventRecurrence,
        recurrences,
        originalEditEventData,
        oldEditEventData,
        isInvitation,
        inviteActions: updatedInviteActions,
        selfAttendeeToken,
        sendIcs,
    });
    const successText = getRecurringEventDeletedText(deleteType, deleteInviteActions);
    return {
        syncActions: multiSyncActions,
        updatePartstatActions,
        updatePersonalPartActions,
        texts: {
            success: successText,
        },
    };
};

export default getDeleteEventActions;
