import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {WebView, WebViewNavigation} from 'react-native-webview';
import {validateProviderUrl} from '../../lib/sandbox/urlGuard';

type Props = {
  uri: string;
  title: string;
  onBack: () => void;
};

const canOpenUrl = (value: string): boolean => {
  try {
    validateProviderUrl(value);
    return true;
  } catch {
    return false;
  }
};

const EmbeddedStreamPlayer = ({uri, title, onBack}: Props): React.JSX.Element => {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState(uri);

  const handleBack = useCallback(() => {
    if (canGoBack) {
      webViewRef.current?.goBack();
    } else {
      onBack();
    }
  }, [canGoBack, onBack]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  const handleNavigationChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
    if (canOpenUrl(state.url)) setCurrentUrl(state.url);
  }, []);

  const openExternally = useCallback(() => {
    if (!canOpenUrl(currentUrl)) {
      ToastAndroid.show('Unsupported link', ToastAndroid.SHORT);
      return;
    }
    Linking.openURL(currentUrl).catch(() => {
      ToastAndroid.show('Could not open the browser', ToastAndroid.SHORT);
    });
  }, [currentUrl]);

  return (
    <View style={{flex: 1, backgroundColor: '#000000'}}>
      <View
        style={{
          minHeight: 48,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#101010',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.10)',
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={handleBack}
          hitSlop={10}
          style={{padding: 8}}>
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: '#FFFFFF',
            fontSize: 14,
            fontWeight: '600',
            marginHorizontal: 10,
          }}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open in browser"
          onPress={openExternally}
          hitSlop={10}
          style={{padding: 8}}>
          <MaterialIcons name="open-in-browser" size={21} color="#FFFFFF" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close player"
          onPress={onBack}
          hitSlop={10}
          style={{padding: 8}}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <View style={{flex: 1, backgroundColor: '#000000'}}>
        <WebView
          ref={webViewRef}
          source={{uri}}
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
          onError={event => {
            setLoading(false);
            setLoadError(event.nativeEvent.description || 'Unable to load this embedded player.');
          }}
          onHttpError={event => {
            if (event.nativeEvent.statusCode >= 400) {
              setLoading(false);
              setLoadError('The embedded player returned HTTP ' + event.nativeEvent.statusCode + '.');
            }
          }}
          onNavigationStateChange={handleNavigationChange}
          onShouldStartLoadWithRequest={request =>
            request.url === 'about:blank' || canOpenUrl(request.url)
          }
          style={{flex: 1, backgroundColor: '#000000'}}
        />
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
              Loading embedded player…
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
              onPress={() => webViewRef.current?.reload()}
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
      </View>
    </View>
  );
};

export default EmbeddedStreamPlayer;
