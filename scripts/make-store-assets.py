# 生成 Edge 商店所需图片素材：300x300 扩展徽标 + 1280x800 屏幕截图
from PIL import Image
import os

root = r"E:\Downloads\Pubmed-IF-Tag"
out = os.path.join(root, "store-assets")
os.makedirs(out, exist_ok=True)

# 1. 扩展徽标 300x300（1:1，官方推荐尺寸）
logo = Image.open(os.path.join(root, "icons", "icon128.png")).convert("RGBA")
logo300 = logo.resize((300, 300), Image.LANCZOS)
logo300.save(os.path.join(out, "logo-300.png"))
print("logo-300.png", logo300.size)

# 2. 屏幕截图 1280x800（16:10，官方认可尺寸）
shot = Image.open(os.path.join(root, "site", "img", "effect-search.png")).convert("RGB")
w, h = shot.size
print("source screenshot:", w, h)
target_h = int(round(w * 10 / 16))  # 保持宽度，裁成 16:10
cropped = shot.crop((0, 0, w, target_h))
resized = cropped.resize((1280, 800), Image.LANCZOS)
resized.save(os.path.join(out, "screenshot-1-1280x800.png"))
print("screenshot-1-1280x800.png", resized.size)

print("done ->", out)
