from datasets import load_dataset
from pathlib import Path

OUTPUT = Path(__file__).parent

print("Loading SPARK-2026 in streaming mode...")

ds = load_dataset(
    "CVI2-UniLU/SPARK-2026",
    split="train",
    streaming=True
)

print("Saving first 20 samples...")

for index, sample in enumerate(ds.take(20)):
    print(f"Sample {index + 1}")

    print("Available fields:", sample.keys())

    # Save image if available
    image = sample.get("image")

    if image is not None:
        image_path = OUTPUT / f"sample_{index + 1:02d}.jpg"
        image.save(image_path)
        print("Saved:", image_path)

    # Print all non-image information
    for key, value in sample.items():
        if key != "image":
            print(f"{key}: {value}")

    print("-" * 50)

print("Done.")