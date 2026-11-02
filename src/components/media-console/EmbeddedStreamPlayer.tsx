import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  PanResponder,
  Pressable,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {WebView} from 'react-native-webview';
import {validateProviderUrl} from '../../lib/sandbox/urlGuard';

type Props = {
  uri: string;
  title: string;
  onBack: () => void;
};

type FrameXTVMessage = {
  event?: string;
  currentTime?: number;
  duration?: number;
};

type EmbedConfig = {
  uri: string;
  origin: string;
  error?: string;
};

const formatTime = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(remainder).padStart(2, '0');
  return hours > 0 ? hours + ':' + mm + ':' + ss : mm + ':' + ss;
};

const resolveEmbed = (raw: string): EmbedConfig => {
  try {
    validateProviderUrl(raw);
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (
      !['framextv.xyz', 'www.framextv.xyz', 'framextv.cc', 'www.framextv.cc'].includes(host) ||
      parsed.protocol !== 'https:' ||
      !/^\/embed\/\d+(?:\/\d+\/\d+)?\/?$/.test(parsed.pathname)
    ) {
      throw new Error('This is not a supported FrameXTV embed URL.');
    }
    // FrameXTV documents controls=0 for hiding its own control bar and a
    // postMessage API for host-app controls. The embed remains FrameXTV's player.
    parsed.searchParams.set('controls', '0');
    parsed.searchParams.set('autoplay', '1');
    parsed.searchParams.set('muted', '0');
    return {uri: parsed.toString(), origin: parsed.origin};
  } catch (error) {
    return {
      uri: '',
      origin: '',
      error: error instanceof Error ? error.message : 'Invalid FrameXTV embed URL.',
    };
  }
};

const createEmbedDocument = (embedUri: string, embedOrigin: string): string => {
  const uriLiteral = JSON.stringify(embedUri);
  const originLiteral = JSON.stringify(embedOrigin);
  return [
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">',
    '<style>html,body,#frame-root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{display:block;width:100%;height:100%;border:0;background:#000}</style>',
    '</head><body><div id="frame-root"><iframe id="framextv-player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe></div>',
    '<script>',
    'const frame=document.getElementById("framextv-player");',
    'const embedUri=' + uriLiteral + ';',
    'const embedOrigin=' + originLiteral + ';',
    'frame.src=embedUri;',
    'window.addEventListener("message",function(event){',
    'if(event.origin!==embedOrigin)return;',
    'const data=event.data;',
    'if(data&&typeof data==="object"&&typeof data.event==="string"&&window.ReactNativeWebView){',
    'window.ReactNativeWebView.postMessage(JSON.stringify(data));',
    '}',
    '});',
    'window.addEventListener("vega-framextv-command",function(event){',
    'if(!frame.contentWindow||!event.detail||typeof event.detail!=="object")return;',
    'frame.contentWindow.postMessage(event.detail,embedOrigin);',
    '});',
    '</script></body></html>',
  ].join('');
};

const EmbeddedStreamPlayer = ({uri, title, onBack}: Props): React.JSX.Element => {
  const webViewRef = useRef<WebView>(null);
  const seekTrackRef = useRef<View>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekTrackWidth, setSeekTrackWidth] = useState(0);
  const [seekTrackLeft, setSeekTrackLeft] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

  const embed = useMemo(() => resolveEmbed(uri), [uri]);
  const html = useMemo(
    () => embed.uri ? createEmbedDocument(embed.uri, embed.origin) : '',
    [embed.uri, embed.origin],
  );

  const sendCommand = useCallback((command: Record<string, unknown>) => {
    const serialized = JSON.stringify(command);
    webViewRef.current?.injectJavaScript(
      'window.dispatchEvent(new CustomEvent("vega-framextv-command",{detail:' +
        serialized +
        '})); true;',
    );
  }, []);

  const handleBack = useCallback(() => onBack(), [onBack]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  useEffect(() => {
    if (embed.error) {
      setLoadError(embed.error);
      setLoading(false);
    }
  }, [embed.error]);

  const handlePlayerMessage = useCallback((raw: string) => {
    try {
      const message = JSON.parse(raw) as FrameXTVMessage;
      if (message.event === 'frameXTV:timeupdate') {
        if (typeof message.currentTime === 'number' && Number.isFinite(message.currentTime)) {
          setCurrentTime(Math.max(0, message.currentTime));
        }
        if (typeof message.duration === 'number' && Number.isFinite(message.duration)) {
          setDuration(Math.max(0, message.duration));
        }
        setIsPlaying(true);
      } else if (message.event === 'frameXTV:play') {
        setIsPlaying(true);
      } else if (message.event === 'frameXTV:pause' || message.event === 'frameXTV:ended') {
        setIsPlaying(false);
      }
    } catch {
      // Ignore messages that are not valid FrameXTV playback telemetry.
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    const nextPlaying = !isPlaying;
    sendCommand({action: nextPlaying ? 'play' : 'pause'});
    setIsPlaying(nextPlaying);
  }, [isPlaying, sendCommand]);

  const seekTo = useCallback((time: number) => {
    if (duration <= 0) return;
    const target = Math.max(0, Math.min(duration, time));
    sendCommand({action: 'seek', time: target});
    setCurrentTime(target);
    setSeekPreview(null);
  }, [duration, sendCommand]);

  const getTimeAtPageX = useCallback((pageX: number) => {
    if (duration <= 0 || seekTrackWidth <= 0) return currentTime;
    const fraction = Math.max(0, Math.min(1, (pageX - seekTrackLeft) / seekTrackWidth));
    return fraction * duration;
  }, [currentTime, duration, seekTrackLeft, seekTrackWidth]);

  const seekResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => duration > 0,
        onMoveShouldSetPanResponder: () => duration > 0,
        onPanResponderGrant: event => {
          setSeekPreview(getTimeAtPageX(event.nativeEvent.pageX));
        },
        onPanResponderMove: (_event, gesture) => {
          setSeekPreview(getTimeAtPageX(gesture.moveX));
        },
        onPanResponderRelease: (_event, gesture) => {
          seekTo(getTimeAtPageX(gesture.moveX));
        },
        onPanResponderTerminate: () => setSeekPreview(null),
      }),
    [duration, getTimeAtPageX, seekTo],
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    sendCommand({action: 'setVolume', volume: nextMuted ? 0 : 1});
    setIsMuted(nextMuted);
  }, [isMuted, sendCommand]);

  const progress = duration > 0
    ? Math.max(0, Math.min(1, (seekPreview ?? currentTime) / duration))
    : 0;

  return (
    <View style={{flex: 1, backgroundColor: '#000000'}}>
      {embed.uri ? (
        <WebView
          ref={webViewRef}
          source={{html, baseUrl: 'https://framextv.cc'}}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          setSupportMultipleWindows={false}
          onLoadStart={() => {
            setLoading(true);
            setLoadError(null);
          }}
          onLoadEnd={() => setLoading(false)}
          onMessage={event => handlePlayerMessage(event.nativeEvent.data)}
          onError={event => {
            setLoading(false);
            setLoadError(event.nativeEvent.description || 'Unable to load FrameXTV.');
          }}
          onShouldStartLoadWithRequest={request =>
            request.url === 'about:blank' || request.url.startsWith('https://')
          }
          style={{flex: 1, backgroundColor: '#000000'}}
        />
      ) : null}

      {loading && !loadError ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000000',
          }}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={{color: 'rgba(255,255,255,0.75)', marginTop: 12}}>
            Loading FrameXTV…
          </Text>
        </View>
      ) : null}

      {loadError ? (
        <View
          style={{
            position: 'absolute',
            left: 24,
            right: 24,
            top: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#000000',
          }}>
          <MaterialIcons name="error-outline" size={38} color="#F87171" />
          <Text style={{color: '#FFFFFF', textAlign: 'center', marginTop: 12}}>
            {loadError}
          </Text>
          <Pressable
            onPress={() => {
              setLoadError(null);
              webViewRef.current?.reload();
            }}
            style={{
              marginTop: 18,
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 22,
              backgroundColor: '#FFFFFF',
            }}>
            <Text style={{color: '#111111', fontWeight: '700'}}>Reload</Text>
          </Pressable>
        </View>
      ) : null}

      {!loadError ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            justifyContent: 'space-between',
          }}>
          <View
            pointerEvents="box-none"
            style={{
              minHeight: 54,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.50)',
            }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Vega"
              onPress={handleBack}
              hitSlop={10}
              style={{padding: 8}}>
              <MaterialIcons name="arrow-back" size={23} color="#FFFFFF" />
            </Pressable>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: '#FFFFFF',
                fontSize: 15,
                fontWeight: '600',
                marginHorizontal: 10,
              }}>
              {title}
            </Text>
            <Text style={{color: 'rgba(255,255,255,0.72)', fontSize: 11}}>
              FrameXTV
            </Text>
          </View>

          <View
            pointerEvents="box-none"
            style={{
              paddingHorizontal: 18,
              paddingTop: 22,
              paddingBottom: 18,
              backgroundColor: 'rgba(0,0,0,0.68)',
            }}>
            <View
              ref={seekTrackRef}
              onLayout={event => {
                setSeekTrackWidth(event.nativeEvent.layout.width);
                seekTrackRef.current?.measureInWindow(x => setSeekTrackLeft(x));
              }}
              {...seekResponder.panHandlers}
              style={{
                height: 24,
                justifyContent: 'center',
                marginBottom: 6,
              }}>
              <View
                style={{
                  height: 4,
                  borderRadius: 4,
                  backgroundColor: 'rgba(255,255,255,0.34)',
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    width: String(progress * 100) + '%',
                    height: 4,
                    borderRadius: 4,
                    backgroundColor: '#FFD7C2',
                  }}
                />
              </View>
              <View
                style={{
                  position: 'absolute',
                  left: String(progress * 100) + '%',
                  marginLeft: -6,
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: '#FFD7C2',
                }}
              />
            </View>

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}>
              <Text style={{color: '#FFFFFF', fontSize: 12}}>
                {formatTime(seekPreview ?? currentTime)}
              </Text>
              <Text style={{color: 'rgba(255,255,255,0.78)', fontSize: 12}}>
                {formatTime(duration)}
              </Text>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 34,
              }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Rewind 10 seconds"
                onPress={() => seekTo(currentTime - 10)}
                hitSlop={10}
                style={{padding: 6}}>
                <MaterialIcons name="replay-10" size={31} color="#FFFFFF" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                onPress={togglePlayPause}
                hitSlop={12}
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#FFD7C2',
                }}>
                <MaterialIcons
                  name={isPlaying ? 'pause' : 'play-arrow'}
                  size={36}
                  color="#17110F"
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Forward 10 seconds"
                onPress={() => seekTo(currentTime + 10)}
                hitSlop={10}
                style={{padding: 6}}>
                <MaterialIcons name="forward-10" size={31} color="#FFFFFF" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
                onPress={toggleMute}
                hitSlop={10}
                style={{padding: 6}}>
                <MaterialIcons
                  name={isMuted ? 'volume-off' : 'volume-up'}
                  size={25}
                  color="#FFFFFF"
                />
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};

export default EmbeddedStreamPlayer;
