import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { RightPanelSide } from "../panels/types";

interface RightPanelResizeHandleProps {
  disabled: boolean;
  maxWidth: number;
  minWidth: number;
  onCollapse: () => void;
  onWidthChange: (width: number) => void;
  width: number;
  side: RightPanelSide;
}

export function RightPanelResizeHandle({
  disabled,
  maxWidth,
  minWidth,
  onCollapse,
  onWidthChange,
  side,
  width,
}: RightPanelResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; nextWidth: number } | null>(null);
  const bodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  function restoreBodyStyles() {
    const previous = bodyStyleRef.current;
    if (!previous) return;
    if (previous.userSelect) document.body.style.userSelect = previous.userSelect;
    else document.body.style.removeProperty("user-select");
    if (previous.cursor) document.body.style.cursor = previous.cursor;
    else document.body.style.removeProperty("cursor");
    bodyStyleRef.current = null;
  }

  useEffect(() => {
    const onWindowBlur = () => cancelDrag();
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      dragRef.current = null;
      restoreBodyStyles();
    };
  }, []);

  function scheduleWidth(nextWidth: number) {
    const clamped = Math.min(Math.max(nextWidth, minWidth), maxWidth);
    const drag = dragRef.current;
    if (drag) drag.nextWidth = clamped;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (dragRef.current) onWidthChange(dragRef.current.nextWidth);
    });
  }

  function finishDrag(pointerId?: number) {
    const handle = handleRef.current;
    const drag = dragRef.current;
    if (!drag) return;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    onWidthChange(drag.nextWidth);
    if (handle && pointerId !== undefined && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    restoreBodyStyles();
  }

  function cancelDrag() {
    if (!dragRef.current) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    dragRef.current = null;
    setDragging(false);
    restoreBodyStyles();
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary || maxWidth < minWidth) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      nextWidth: width,
    };
    handleRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
    bodyStyleRef.current = {
      userSelect: document.body.style.userSelect,
      cursor: document.body.style.cursor,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    scheduleWidth(drag.startWidth + (side === "left" ? event.clientX - drag.startX : drag.startX - event.clientX));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if ((side === "right" && event.key === "ArrowLeft") || (side === "left" && event.key === "ArrowRight")) {
      event.preventDefault();
      onWidthChange(Math.min(maxWidth, width + 10));
    } else if ((side === "right" && event.key === "ArrowRight") || (side === "left" && event.key === "ArrowLeft")) {
      event.preventDefault();
      onWidthChange(Math.max(minWidth, width - 10));
    } else if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(minWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      onWidthChange(maxWidth);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onCollapse();
    }
  }

  return (
    <div
      aria-controls="right-panel"
      aria-label="Resize supporting tools panel"
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={minWidth}
      aria-valuenow={width}
      aria-valuetext={`${Math.round(width)} pixels`}
      className={`right-panel-resize-handle${dragging ? " right-panel-resize-handle-dragging" : ""}`}
      onKeyDown={onKeyDown}
      onLostPointerCapture={() => finishDrag()}
      onPointerCancel={cancelDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event.pointerId)}
      ref={handleRef}
      role="separator"
      tabIndex={disabled ? -1 : 0}
    />
  );
}
