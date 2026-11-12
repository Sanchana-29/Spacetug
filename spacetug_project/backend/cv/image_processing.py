import cv2
import numpy as np
from typing import Dict, Any

def process_image_pipeline(
    image: np.ndarray,
    brightness: float = 0.0,
    contrast: float = 1.0,
    grayscale: bool = False,
    gaussian_blur: int = 0,
    sharpen: bool = False,
    denoise: bool = False,
    edge_detection: bool = False,
    resize_width: int = 0,
    resize_height: int = 0,
) -> Dict[str, Any]:
    """
    Applies an explicit sequence of OpenCV operations to an input image.
    Returns the processed image and execution stage metrics.
    """
    if image is None:
        raise ValueError("Image buffer is invalid or empty.")

    stages_executed = []
    current = image.copy()

    # 1. Resize if requested
    if resize_width > 0 and resize_height > 0:
        current = cv2.resize(current, (resize_width, resize_height), interpolation=cv2.INTER_LINEAR)
        stages_executed.append({
            "stage": "Resize",
            "params": f"{resize_width}x{resize_height}"
        })

    # 2. Brightness & Contrast (software adjustment via convertScaleAbs: current * alpha + beta)
    # alpha = contrast, beta = brightness (e.g. -100 to 100)
    if contrast != 1.0 or brightness != 0.0:
        alpha = max(0.1, min(3.0, float(contrast)))
        beta = max(-100.0, min(100.0, float(brightness)))
        current = cv2.convertScaleAbs(current, alpha=alpha, beta=beta)
        stages_executed.append({
            "stage": "Brightness & Contrast",
            "params": f"alpha={alpha:.2f}, beta={beta:.1f}"
        })

    # 3. Denoising
    if denoise:
        if len(current.shape) == 3 and current.shape[2] == 3:
            current = cv2.fastNlMeansDenoisingColored(current, None, 7, 7, 7, 21)
        else:
            current = cv2.fastNlMeansDenoising(current, None, 7, 7, 21)
        stages_executed.append({
            "stage": "Non-Local Means Denoising",
            "params": "h=7"
        })

    # 4. Gaussian Blur
    if gaussian_blur > 0:
        # Kernel size must be positive and odd
        k = int(gaussian_blur)
        if k % 2 == 0:
            k += 1
        k = max(3, min(31, k))
        current = cv2.GaussianBlur(current, (k, k), 0)
        stages_executed.append({
            "stage": "Gaussian Blur",
            "params": f"kernel={k}x{k}"
        })

    # 5. Sharpening
    if sharpen:
        sharpen_kernel = np.array([
            [0, -1, 0],
            [-1, 5, -1],
            [0, -1, 0]
        ], dtype=np.float32)
        current = cv2.filter2D(current, -1, sharpen_kernel)
        stages_executed.append({
            "stage": "Unsharp Masking / Sharpen",
            "params": "3x3 kernel"
        })

    # 6. Grayscale Conversion
    if grayscale or edge_detection:
        if len(current.shape) == 3 and current.shape[2] >= 3:
            current = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY)
            stages_executed.append({
                "stage": "Grayscale Conversion",
                "params": "COLOR_BGR2GRAY"
            })

    # 7. Edge Detection (Canny)
    if edge_detection:
        current = cv2.Canny(current, threshold1=50, threshold2=150)
        stages_executed.append({
            "stage": "Canny Edge Detection",
            "params": "thresholds=(50, 150)"
        })

    # Format return image to 3-channel BGR for unified web encoding
    if len(current.shape) == 2:
        return_img = cv2.cvtColor(current, cv2.COLOR_GRAY2BGR)
    else:
        return_img = current

    return {
        "processed_image": return_img,
        "stages_executed": stages_executed,
        "final_shape": [int(return_img.shape[1]), int(return_img.shape[0])],
    }
