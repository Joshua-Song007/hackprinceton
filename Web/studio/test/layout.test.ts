import { describe, expect, it } from 'vitest';
import { panelsToOffer } from '../src/layout';

const added = [{ id: 'peripherals', beside: 'explorer' }];

describe('panelsToOffer', () => {
  it('offers an added panel a saved layout lacks, once', () => {
    expect(panelsToOffer(['explorer', 'viewport'], [], ['explorer', 'peripherals'], added)).toEqual(added);
    expect(panelsToOffer(['explorer', 'viewport'], ['peripherals'], ['explorer', 'peripherals'], added)).toEqual([]);
  });
  it('does nothing when the panel is already open', () => {
    expect(panelsToOffer(['explorer', 'peripherals'], [], ['explorer', 'peripherals'], added)).toEqual([]);
  });
  it('needs the panel to be registered and its neighbour to be open', () => {
    expect(panelsToOffer(['explorer'], [], ['explorer'], added)).toEqual([]);
    expect(panelsToOffer(['viewport'], [], ['explorer', 'peripherals'], added)).toEqual([]);
  });
  it('the real list offers Peripherals beside the Explorer', () => {
    expect(panelsToOffer(['explorer'], [], ['explorer', 'peripherals'])).toEqual(added);
  });
});
