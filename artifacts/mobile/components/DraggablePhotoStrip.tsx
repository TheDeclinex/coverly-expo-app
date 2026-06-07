import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";
import { useSignedUrl } from "@/hooks/useSignedUrls";

export interface PhotoEntry {
  url: string;
  caption: string;
}

const CARD_W = 130;
const CARD_H = 100;
const CARD_GAP = 10;
const SWAP_THRESHOLD = CARD_W * 0.45;

function PhotoCard({
  photo,
  index,
  total,
  onMoveLeft,
  onMoveRight,
  onDelete,
  onCaptionChange,
  colors,
}: {
  photo: PhotoEntry;
  index: number;
  total: number;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
  onCaptionChange: (caption: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const isDragging = useSharedValue(false);

  const triggerImpact = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const triggerLight = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(450)
    .onStart(() => {
      isDragging.value = true;
      scale.value = withSpring(1.06, { damping: 15 });
      runOnJS(triggerImpact)();
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd(() => {
      const tx = translateX.value;
      if (tx > SWAP_THRESHOLD && index < total - 1) {
        runOnJS(onMoveRight)();
        runOnJS(triggerLight)();
      } else if (tx < -SWAP_THRESHOLD && index > 0) {
        runOnJS(onMoveLeft)();
        runOnJS(triggerLight)();
      }
      translateX.value = withSpring(0, { damping: 18 });
      scale.value = withSpring(1, { damping: 15 });
      isDragging.value = false;
    })
    .onFinalize(() => {
      translateX.value = withSpring(0, { damping: 18 });
      scale.value = withSpring(1, { damping: 15 });
      isDragging.value = false;
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
    zIndex: isDragging.value ? 999 : 1,
    shadowOpacity: isDragging.value ? 0.25 : 0,
    shadowRadius: isDragging.value ? 8 : 0,
    shadowOffset: isDragging.value ? { width: 0, height: 4 } : { width: 0, height: 0 },
    elevation: isDragging.value ? 6 : 0,
  }));

  // Resolve storage path → signed URL; local file:// URIs and legacy https:// URLs
  // pass through unchanged. undefined while loading → show broken state gracefully.
  const resolvedUrl = useSignedUrl(photo.url);

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[animStyle, { width: CARD_W, gap: 6 }]}>
        <View style={{ position: "relative" }}>
          <Image
            source={resolvedUrl ? { uri: resolvedUrl } : undefined}
            style={{
              width: CARD_W,
              height: CARD_H,
              borderRadius: colors.radius,
              borderWidth: index === 0 ? 2 : 1,
              borderColor: index === 0 ? colors.primary : colors.border,
            }}
            contentFit="cover"
            transition={150}
          />

          {index === 0 && (
            <View
              style={{
                position: "absolute",
                top: 5,
                left: 5,
                backgroundColor: colors.primary,
                borderRadius: 4,
                paddingHorizontal: 5,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.primaryForeground,
                  letterSpacing: 0.6,
                }}
              >
                PRIMARY
              </Text>
            </View>
          )}

          <Pressable
            onPress={onDelete}
            hitSlop={10}
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              backgroundColor: "rgba(0,0,0,0.55)",
              borderRadius: 99,
              width: 22,
              height: 22,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="x" size={11} color="#fff" />
          </Pressable>

          <View
            style={{
              position: "absolute",
              bottom: 5,
              right: 5,
              opacity: 0.7,
            }}
          >
            <Feather name="menu" size={13} color="#fff" />
          </View>
        </View>

        <TextInput
          value={photo.caption}
          onChangeText={onCaptionChange}
          placeholder="Caption…"
          placeholderTextColor={colors.mutedForeground}
          style={{
            fontSize: 11,
            fontFamily: "Inter_400Regular",
            color: colors.foreground,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: Math.max(4, colors.radius - 2),
            paddingHorizontal: 6,
            paddingVertical: 4,
            backgroundColor: colors.card,
            width: CARD_W,
          }}
          maxLength={60}
          returnKeyType="done"
        />
      </Animated.View>
    </GestureDetector>
  );
}

interface Props {
  photos: PhotoEntry[];
  onChange: (photos: PhotoEntry[]) => void;
  colors: ReturnType<typeof useColors>;
}

export function DraggablePhotoStrip({ photos, onChange, colors }: Props) {
  const moveLeft = useCallback(
    (index: number) => {
      if (index === 0) return;
      const next = [...photos];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      onChange(next);
    },
    [photos, onChange]
  );

  const moveRight = useCallback(
    (index: number) => {
      if (index === photos.length - 1) return;
      const next = [...photos];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      onChange(next);
    },
    [photos, onChange]
  );

  const deletePhoto = useCallback(
    (index: number) => {
      onChange(photos.filter((_, i) => i !== index));
    },
    [photos, onChange]
  );

  const updateCaption = useCallback(
    (index: number, caption: string) => {
      onChange(photos.map((p, i) => (i === index ? { ...p, caption } : p)));
    },
    [photos, onChange]
  );

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      onChange([...photos, { url: result.assets[0].uri, caption: "" }]);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      onChange([...photos, { url: result.assets[0].uri, caption: "" }]);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_400Regular",
          color: colors.mutedForeground,
        }}
      >
        Hold & drag a photo to reorder · First photo is the cover
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: CARD_GAP, paddingBottom: 4 }}
        keyboardShouldPersistTaps="handled"
      >
        {photos.map((photo, index) => (
          <PhotoCard
            key={`${photo.url}-${index}`}
            photo={photo}
            index={index}
            total={photos.length}
            onMoveLeft={() => moveLeft(index)}
            onMoveRight={() => moveRight(index)}
            onDelete={() => deletePhoto(index)}
            onCaptionChange={(caption) => updateCaption(index, caption)}
            colors={colors}
          />
        ))}

        <View style={{ gap: 6, justifyContent: "center", paddingLeft: 4 }}>
          <Pressable
            onPress={takePhoto}
            style={({ pressed }) => ({
              width: CARD_W,
              height: CARD_H / 2 - 3,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 5,
              opacity: pressed ? 0.7 : 1,
              backgroundColor: colors.card,
            })}
          >
            <Feather name="camera" size={14} color={colors.primary} />
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: colors.primary,
              }}
            >
              Camera
            </Text>
          </Pressable>

          <Pressable
            onPress={pickPhoto}
            style={({ pressed }) => ({
              width: CARD_W,
              height: CARD_H / 2 - 3,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 5,
              opacity: pressed ? 0.7 : 1,
              backgroundColor: colors.card,
            })}
          >
            <Feather name="image" size={14} color={colors.primary} />
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: colors.primary,
              }}
            >
              Library
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
