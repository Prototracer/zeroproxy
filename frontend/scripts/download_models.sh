#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/../public/models"
SOURCE_DIR="$SCRIPT_DIR/../node_modules/@vladmandic/face-api/model"

mkdir -p "$TARGET_DIR"

FILES=(
  "tiny_face_detector_model-weights_manifest.json"
  "tiny_face_detector_model.bin"
  "face_landmark_68_model-weights_manifest.json"
  "face_landmark_68_model.bin"
  "face_recognition_model-weights_manifest.json"
  "face_recognition_model.bin"
)

echo "Copying face-api models to $TARGET_DIR..."

for FILE in "${FILES[@]}"; do
  if [ -f "$TARGET_DIR/$FILE" ]; then
    echo "  [skip] $FILE already exists."
  else
    if [ -f "$SOURCE_DIR/$FILE" ]; then
      echo "  [copy] $FILE from node_modules..."
      cp "$SOURCE_DIR/$FILE" "$TARGET_DIR/$FILE"
    else
      echo "  [download] $FILE from GitHub..."
      curl -sSfL "https://raw.githubusercontent.com/vladmandic/face-api/master/model/$FILE" -o "$TARGET_DIR/$FILE"
    fi
  fi
done

echo "All models ready in $TARGET_DIR!"
