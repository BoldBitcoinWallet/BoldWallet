import {NativeModules} from 'react-native';
import {holdScreenAwake} from '../services/screenAwake';

describe('holdScreenAwake', () => {
  const previous = NativeModules.MpcKeepAliveModule;

  afterEach(() => {
    NativeModules.MpcKeepAliveModule = previous;
  });

  it('restores the awake flag it observed', async () => {
    const setScreenAwake = jest.fn(async () => true);
    const isScreenAwake = jest.fn(async () => true);
    NativeModules.MpcKeepAliveModule = {setScreenAwake, isScreenAwake};

    const release = await holdScreenAwake();
    expect(setScreenAwake).toHaveBeenCalledWith(true);
    release();
    expect(setScreenAwake).toHaveBeenLastCalledWith(true);
    release();
    expect(setScreenAwake).toHaveBeenCalledTimes(2);
  });

  it('turns the flag back off when the screen was allowed to sleep', async () => {
    const setScreenAwake = jest.fn(async () => true);
    NativeModules.MpcKeepAliveModule = {
      setScreenAwake,
      isScreenAwake: jest.fn(async () => false),
    };

    const release = await holdScreenAwake();
    release();
    expect(setScreenAwake.mock.calls).toEqual([[true], [false]]);
  });

  it('does nothing when the native toggle is absent', async () => {
    NativeModules.MpcKeepAliveModule = {start: jest.fn()};
    const release = await holdScreenAwake();
    release();
    expect(NativeModules.MpcKeepAliveModule.start).not.toHaveBeenCalled();
  });
});