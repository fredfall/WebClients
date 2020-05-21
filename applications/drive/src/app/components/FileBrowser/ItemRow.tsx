import React, { useRef } from 'react';
import { c } from 'ttag';

import { TableRow, Checkbox, Time, useActiveBreakpoint, classnames } from 'react-components';
import readableTime from 'proton-shared/lib/helpers/readableTime';
import { dateLocale } from 'proton-shared/lib/i18n';
import humanSize from 'proton-shared/lib/helpers/humanSize';

import { LinkType } from '../../interfaces/link';
import { FileBrowserItem } from './FileBrowser';
import MimeIcon from '../FileIcon';
import LocationCell from './LocationCell';

interface Props {
    item: FileBrowserItem;
    shareId: string;
    selectedItems: FileBrowserItem[];
    onToggleSelect: (item: string) => void;
    onShiftClick: (item: string) => void;
    onClick?: (item: FileBrowserItem) => void;
    showLocation?: boolean;
}

const ItemRow = ({ item, shareId, selectedItems, onToggleSelect, onClick, onShiftClick, showLocation }: Props) => {
    const { isDesktop } = useActiveBreakpoint();
    const touchStarted = useRef(false);

    const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
        e.stopPropagation();
        if (e.shiftKey) {
            onShiftClick(item.LinkID);
        } else if (e.ctrlKey || e.metaKey) {
            onToggleSelect(item.LinkID);
        } else {
            onClick?.(item);
        }
    };

    const handleTouchStart = (e: React.TouchEvent<HTMLTableRowElement>) => {
        e.stopPropagation();
        touchStarted.current = true;
    };

    const handleTouchCancel = () => {
        if (touchStarted.current) {
            touchStarted.current = false;
        }
    };

    const handleTouchEnd = () => {
        if (touchStarted.current) {
            onClick?.(item);
        }
        touchStarted.current = false;
    };

    const isFolder = item.Type === LinkType.FOLDER;
    const isSelected = selectedItems.some(({ LinkID }) => item.LinkID === LinkID);
    const cells = [
        <div
            key="select"
            className="flex"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
        >
            <Checkbox
                className="increase-surface-click"
                checked={isSelected}
                onChange={(e) => {
                    if (isSelected) {
                        e.target.blur();
                    }
                    onToggleSelect(item.LinkID);
                }}
            />
        </div>,
        <div key="filename" className="flex flex-items-center flex-nowrap">
            <MimeIcon mimeType={item.Type === LinkType.FOLDER ? 'Folder' : item.MimeType} />
            <span title={item.Name} className="ellipsis">
                {item.Name}
            </span>
        </div>,
        showLocation && <LocationCell shareId={shareId} item={item} />,
        isFolder ? c('Label').t`Folder` : c('Label').t`File`,
        isDesktop && (
            <div
                className="ellipsis"
                title={readableTime(item.Trashed ?? item.Modified, 'PPp', { locale: dateLocale })}
            >
                <Time key="dateModified" format="PPp">
                    {item.Trashed ?? item.Modified}
                </Time>
            </div>
        ),
        item.Size ? (
            <div className="ellipsis" title={humanSize(item.Size)}>
                {humanSize(item.Size)}
            </div>
        ) : (
            '-'
        )
    ].filter(Boolean);

    return (
        <TableRow
            className={classnames(['cursor-pointer', isSelected && 'bg-global-highlight'])}
            onMouseDown={() => document.getSelection()?.removeAllRanges()}
            onClick={handleRowClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchCancel}
            onTouchCancel={handleTouchCancel}
            onTouchEnd={handleTouchEnd}
            cells={cells}
        />
    );
};

export default ItemRow;
