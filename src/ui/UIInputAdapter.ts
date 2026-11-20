import type { GameServices } from '../core/GameServices';
import type { PointerSnapshot } from '../core/InputManager';
import type { UIFrameInput } from './UILayout';

const NO_INPUT: UIFrameInput = {
  pointer: null,
  pointerDown: false,
  pointerPressed: false,
  pointerReleased: false,
  pointerMoved: false,
  navigateUp: false,
  navigateDown: false,
  navigateLeft: false,
  navigateRight: false,
  activate: false,
  back: false,
};

/** Translates raw device input into the virtual-space UI input contract consumed by UIFocusGroup. */
export function buildUiFrameInput(services: GameServices, inputEnabled: boolean): UIFrameInput {
  if (!inputEnabled) {
    return NO_INPUT;
  }
  const input = services.input;
  const pointer: PointerSnapshot = input.pointer;
  return {
    pointer: services.ui.clientToVirtual(pointer.clientX, pointer.clientY),
    pointerDown: pointer.isPrimaryDown,
    pointerPressed: pointer.primaryPressedThisFrame,
    pointerReleased: pointer.primaryReleasedThisFrame,
    pointerMoved: pointer.movedThisFrame || pointer.primaryPressedThisFrame,
    navigateUp: input.wasAnyKeyPressed(['ArrowUp', 'KeyW']) || input.wheelSteps < 0,
    navigateDown: input.wasAnyKeyPressed(['ArrowDown', 'KeyS', 'Tab']) || input.wheelSteps > 0,
    navigateLeft: input.wasAnyKeyPressed(['ArrowLeft', 'KeyA']),
    navigateRight: input.wasAnyKeyPressed(['ArrowRight', 'KeyD']),
    activate: input.wasAnyKeyPressed(['Enter', 'NumpadEnter', 'Space']),
    back: input.wasAnyKeyPressed(['Escape', 'Backspace']),
  };
}
