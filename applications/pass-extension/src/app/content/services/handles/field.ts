import { withContext } from 'proton-pass-extension/app/content/context/context';
import type { FieldHandle, FormHandle } from 'proton-pass-extension/app/content/types';
import {
    allowActions,
    preventActions,
    shouldPreventActions,
    withActionTrap,
} from 'proton-pass-extension/app/content/utils/action-trap';
import { createAutofill } from 'proton-pass-extension/app/content/utils/autofill';

import type { FormType } from '@proton/pass/fathom';
import { FieldType } from '@proton/pass/fathom';
import { findBoundingInputElement } from '@proton/pass/utils/dom/input';
import { createListenerStore } from '@proton/pass/utils/listener/factory';

import { createFieldIconHandle } from './icon';

type CreateFieldHandlesOptions = {
    element: HTMLInputElement;
    formType: FormType;
    fieldType: FieldType;
    zIndex: number;
    getFormHandle: () => FormHandle;
};

/* on input focus : close the dropdown only if the current target
 * does not match the dropdown's current field : this maybe the case
 * when changing focus with the dropdown open */
const onFocusField = (field: FieldHandle): ((evt?: FocusEvent) => void) =>
    withContext((ctx, evt) => {
        const { action, element } = field;
        field?.icon?.reposition();

        if (shouldPreventActions(element)) return allowActions(element);
        if (!action) return;

        requestAnimationFrame(() => {
            const target = evt?.target;
            const dropdown = ctx?.service.iframe.dropdown;
            const current = dropdown?.getCurrentField()?.element;
            const opened = dropdown?.getState().visible;

            const shouldClose = opened && current !== target;
            const openOnFocus = ctx?.getSettings().autofill.openOnFocus;
            const shouldOpen = ctx?.getState().loggedIn && (!opened || shouldClose) && openOnFocus;

            if (shouldClose) dropdown?.close();
            if (shouldOpen) ctx?.service.iframe.attachDropdown()?.open({ action, autofocused: true, field });
        });
    });

/* on input change : close the dropdown if it was visible
 * and update the field's handle tracked value */
const onInputField = (field: FieldHandle): (() => void) =>
    withContext((ctx) => {
        const dropdown = ctx?.service.iframe.dropdown;
        if (dropdown?.getState().visible && !shouldPreventActions(field.element)) dropdown?.close();
        field.setValue((field.element as HTMLInputElement).value);
    });

/* when the type attribute of a field changes : detach it from
 * the tracked form and re-trigger the detection */
const onFieldAttributeChange = (field: FieldHandle): MutationCallback =>
    withContext<MutationCallback>((ctx, mutations) => {
        if ([FieldType.PASSWORD_CURRENT, FieldType.PASSWORD_NEW].includes(field.fieldType)) return;

        mutations.forEach((mutation) => {
            const target = mutation.target as HTMLInputElement;
            if (mutation.type === 'attributes' && mutation.oldValue !== target.type) {
                field.getFormHandle().detachField(mutation.target as HTMLInputElement);
                void ctx?.service.formManager.detect({ reason: 'FieldTypeChange' });
            }
        });
    });

/* trigger the submit handler on keydown enter */
const onKeyDownField =
    (onSubmit: () => void) =>
    ({ key }: KeyboardEvent) =>
        key === 'Enter' && onSubmit();

export const createFieldHandles = ({
    element,
    formType,
    fieldType,
    zIndex,
    getFormHandle,
}: CreateFieldHandlesOptions): FieldHandle => {
    const listeners = createListenerStore();
    let boxElement = findBoundingInputElement(element);

    const field: FieldHandle = {
        formType,
        fieldType,
        element,
        boxElement,
        icon: null,
        action: null,
        value: element.value,
        tracked: false,
        zIndex,
        getFormHandle,
        getBoxElement: (options) =>
            options?.revalidate ? (boxElement = findBoundingInputElement(element)) : boxElement,
        setValue: (value) => (field.value = value),
        setAction: (action) => (field.action = action),

        /* if the field is already focused we need to re-dispatch the event on the input
         * element to trigger initial dropdown autofocus. Calling `el.focus()` will not
         * re-dispatch the focus event if it is already the document's active element.
         * In certain cases, we may want to re-focus the element without triggering the
         * attached action effect : as there is no way to attach extra data to a focus event,
         * so we rely on adding custom properties on the field element itself */
        focus(options) {
            const isFocusedField = document.activeElement === field.element;
            if (options?.preventAction) preventActions(field.element);
            field.element.focus();

            if (isFocusedField) {
                const focusEvent = new FocusEvent('focus', {
                    bubbles: true,
                    cancelable: true,
                    relatedTarget: null,
                });

                return field.element.dispatchEvent(focusEvent);
            }
        },

        autofill: withActionTrap(element, createAutofill(element)),

        /* if an icon is already attached recycle it */
        attachIcon: withContext((ctx) => {
            if (!ctx) return;
            return (field.icon = field.icon ?? createFieldIconHandle({ field, elements: ctx.elements }));
        }),

        detachIcon() {
            field.icon?.detach();
            field.icon = null;
        },

        attach(onSubmit) {
            field.tracked = true;
            listeners.removeAll();
            listeners.addListener(field.element, 'blur', () => field.icon?.reposition());
            listeners.addListener(field.element, 'focus', onFocusField(field));
            listeners.addListener(field.element, 'input', onInputField(field));
            listeners.addListener(field.element, 'keydown', onKeyDownField(onSubmit));
            listeners.addObserver(field.element, onFieldAttributeChange(field), {
                attributeFilter: ['type'],
                attributeOldValue: true,
            });
        },

        detach: () => {
            field.tracked = false;
            field.detachIcon();
            listeners.removeAll();
        },
    };

    return field;
};
