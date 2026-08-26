#!/usr/bin/env python3
"""图片导出工具（Python GUI 版本）

直接双击此文件即可打开图形界面。
"""

import argparse
import os
from datetime import datetime
from pathlib import Path
import shutil
import sys

try:
    from PIL import Image, ImageSequence
except ImportError:
    import tkinter as tk
    from tkinter import messagebox
    messagebox.showerror('缺少依赖', '请先安装 Pillow：\npip install pillow')
    sys.exit(1)

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
except ImportError:
    tk = None
    filedialog = None
    messagebox = None


TARGET_WIDTHS = [400, 800, 1200]
GIF_TRANSPARENCY_INDEX = 255


def get_target_widths(original_width: int) -> list[int]:
    return [w for w in TARGET_WIDTHS if w <= original_width] or [min(original_width, TARGET_WIDTHS[-1])]


def build_output_name(prefix: str, width: int, ext: str) -> str:
    return f'{prefix}_w{width}.{ext}'


def resize_gif_frame(frame: Image.Image, size: tuple[int, int]) -> Image.Image:
    resized = frame.convert('RGBA').resize(size, Image.Resampling.LANCZOS)
    alpha = resized.getchannel('A')
    quantized = resized.convert('RGB').quantize(
        colors=GIF_TRANSPARENCY_INDEX,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.FLOYDSTEINBERG,
    )
    palette = (quantized.getpalette() or [])[:GIF_TRANSPARENCY_INDEX * 3]
    quantized.putpalette(palette + [0] * (768 - len(palette)))
    transparent_mask = alpha.point(lambda value: 255 if value < 128 else 0)
    quantized.paste(GIF_TRANSPARENCY_INDEX, mask=transparent_mask)
    quantized.info['transparency'] = GIF_TRANSPARENCY_INDEX
    return quantized


def save_resized_images(image: Image.Image, widths: list[int], output_dir: Path, prefix: str, ext: str) -> list[Path]:
    output_paths = []
    for width in widths:
        ratio = width / image.width
        height = max(1, int(image.height * ratio))
        output_name = build_output_name(prefix, width, ext)
        output_path = output_dir / output_name

        if ext.lower() == 'gif' and getattr(image, 'is_animated', False):
            frames = []
            durations = []
            disposals = []
            for frame in ImageSequence.Iterator(image):
                frames.append(resize_gif_frame(frame, (width, height)))
                durations.append(frame.info.get('duration', image.info.get('duration', 100)))
                disposals.append(getattr(frame, 'disposal_method', 2))
            frames[0].save(
                output_path,
                save_all=True,
                append_images=frames[1:],
                duration=durations,
                loop=image.info.get('loop', 0),
                disposal=disposals,
                transparency=GIF_TRANSPARENCY_INDEX,
                optimize=False,
            )
            output_paths.append(output_path)
            continue

        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        save_kwargs = {}
        if ext.lower() in ('jpg', 'jpeg'):
            save_kwargs['quality'] = 92
            save_kwargs['optimize'] = True
        resized.save(output_path, **save_kwargs)
        output_paths.append(output_path)
    return output_paths


def copy_original_file(source_path: Path, output_dir: Path) -> Path:
    destination = output_dir / source_path.name
    shutil.copy2(source_path, destination)
    return destination


def create_next_subfolder(base_dir: Path) -> Path:
    date_prefix = datetime.now().strftime('%Y%m%d')
    index = 1
    while True:
        subfolder_name = f'{date_prefix}_{index:03d}'
        target = base_dir / subfolder_name
        if not target.exists():
            target.mkdir(parents=True, exist_ok=False)
            return target
        index += 1


def validate_paths(input_path: Path, output_path: Path) -> tuple[bool, str]:
    if not input_path.exists() or not input_path.is_file():
        return False, f'图片文件不存在：{input_path}'
    if not output_path.exists():
        try:
            output_path.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            return False, f'无法创建输出目录：{exc}'
    if not output_path.is_dir():
        return False, f'输出路径不是目录：{output_path}'
    return True, ''


def open_file_dialog() -> Path | None:
    if filedialog is None:
        return None
    path = filedialog.askopenfilename(
        title='选择图片文件',
        filetypes=[('图片文件', '*.jpg *.jpeg *.png *.gif *.webp *.bmp'), ('所有文件', '*.*')],
    )
    return Path(path) if path else None


def open_folder_dialog() -> Path | None:
    if filedialog is None:
        return None
    path = filedialog.askdirectory(title='选择导出文件夹')
    return Path(path) if path else None


def append_log(text_widget: tk.Text, message: str) -> None:
    text_widget.configure(state='normal')
    text_widget.insert('end', message + '\n')
    text_widget.see('end')
    text_widget.configure(state='disabled')


def open_directory(path: Path) -> None:
    if not path.exists() or not path.is_dir():
        raise FileNotFoundError(path)
    if sys.platform == 'win32':
        os.startfile(path)
    elif sys.platform == 'darwin':
        os.system(f'open "{path}"')
    else:
        os.system(f'xdg-open "{path}"')


def export_images(input_path: Path, output_dir: Path, log_widget: tk.Text) -> Path:
    valid, error_message = validate_paths(input_path, output_dir)
    if not valid:
        append_log(log_widget, error_message)
        raise ValueError(error_message)

    with Image.open(input_path) as img:
        if not getattr(img, 'is_animated', False) and img.mode in ('RGBA', 'P', 'LA'):
            img = img.convert('RGB')
        widths = get_target_widths(img.width)
        subfolder = create_next_subfolder(output_dir)
        subfolder_name = subfolder.name
        ext = input_path.suffix.lstrip('.').lower() or 'jpg'

        append_log(log_widget, f'输入图片：{input_path.name}  ({img.width}×{img.height})')
        append_log(log_widget, f'输出目录：{subfolder}')
        append_log(log_widget, f'生成尺寸：{", ".join(str(w) for w in widths)}')

        resized_paths = save_resized_images(img, widths, subfolder, subfolder_name, ext)
        original_copy = copy_original_file(input_path, subfolder)

        for path in resized_paths:
            append_log(log_widget, f'已生成：{path.name}')
        append_log(log_widget, f'已复制原图：{original_copy.name}')
        append_log(log_widget, '导出完成。')
        open_directory(subfolder)
        append_log(log_widget, f'已打开输出文件夹：{subfolder}')
        return subfolder


def run_gui() -> None:
    if tk is None or filedialog is None or messagebox is None:
        print('当前环境不支持 tkinter GUI。请通过命令行运行。')
        return

    root = tk.Tk()
    root.title('图片导出工具')
    root.geometry('700x440')
    root.resizable(False, False)

    input_var = tk.StringVar()
    output_var = tk.StringVar()

    frame = tk.Frame(root, padx=16, pady=16)
    frame.pack(fill='both', expand=True)

    tk.Label(frame, text='1. 选择要处理的图片', font=('Segoe UI', 11, 'bold')).grid(row=0, column=0, columnspan=3, sticky='w')
    input_entry = tk.Entry(frame, textvariable=input_var, width=58)
    input_entry.grid(row=1, column=0, columnspan=2, sticky='we', pady=6)
    tk.Button(frame, text='浏览图片…', width=12, command=lambda: browse_input(input_var, status_text)).grid(row=1, column=2, padx=8)

    tk.Label(frame, text='2. 选择导出文件夹', font=('Segoe UI', 11, 'bold')).grid(row=2, column=0, columnspan=3, sticky='w', pady=(16, 0))
    output_entry = tk.Entry(frame, textvariable=output_var, width=58)
    output_entry.grid(row=3, column=0, columnspan=2, sticky='we', pady=6)
    tk.Button(frame, text='浏览目录…', width=12, command=lambda: browse_output(output_var, status_text)).grid(row=3, column=2, padx=8)

    tk.Label(frame, text='3. 点击“开始生成”', font=('Segoe UI', 11, 'bold')).grid(row=4, column=0, columnspan=3, sticky='w', pady=(16, 0))
    start_button = tk.Button(frame, text='开始生成', width=16, bg='#28a745', fg='white', font=('Segoe UI', 10, 'bold'))
    start_button.grid(row=5, column=0, sticky='w', pady=10)
    clear_button = tk.Button(frame, text='清空日志', width=12, command=lambda: clear_log(status_text))
    clear_button.grid(row=5, column=1, sticky='w', pady=10)

    tk.Label(frame, text='操作日志', font=('Segoe UI', 11, 'bold')).grid(row=6, column=0, columnspan=3, sticky='w')
    status_text = tk.Text(frame, width=78, height=12, wrap='word', state='disabled', bg='#f8f9fa')
    status_text.grid(row=7, column=0, columnspan=3, pady=8, sticky='nsew')

    frame.grid_columnconfigure(0, weight=1)
    frame.grid_columnconfigure(1, weight=1)
    frame.grid_rowconfigure(7, weight=1)

    def on_start() -> None:
        input_path = input_var.get().strip()
        output_path = output_var.get().strip()
        if not input_path:
            messagebox.showwarning('提示', '请先选择图片文件。')
            return
        if not output_path:
            messagebox.showwarning('提示', '请先选择导出文件夹。')
            return

        start_button.config(state='disabled')
        append_log(status_text, '开始导出，请稍候...')
        root.update_idletasks()

        try:
            subfolder = export_images(Path(input_path), Path(output_path), status_text)
            messagebox.showinfo('完成', f'图片已成功导出并复制原图。\n已打开输出文件夹：{subfolder}')
        except Exception as exc:
            messagebox.showerror('错误', str(exc))
            append_log(status_text, f'发生错误：{exc}')
        finally:
            start_button.config(state='normal')

    start_button.config(command=on_start)

    root.protocol('WM_DELETE_WINDOW', root.destroy)
    append_log(status_text, '准备就绪。请选择图片和导出文件夹，然后点击“开始生成”。')
    root.mainloop()


def browse_input(input_var: tk.StringVar, log_widget: tk.Text) -> None:
    path = open_file_dialog()
    if path:
        input_var.set(str(path))
        append_log(log_widget, f'已选择图片：{path.name}')


def browse_output(output_var: tk.StringVar, log_widget: tk.Text) -> None:
    path = open_folder_dialog()
    if path:
        output_var.set(str(path))
        append_log(log_widget, f'已选择导出文件夹：{path}')


def clear_log(text_widget: tk.Text) -> None:
    text_widget.configure(state='normal')
    text_widget.delete('1.0', 'end')
    text_widget.configure(state='disabled')


def run_cli(args: argparse.Namespace) -> int:
    if not args.input:
        print('请通过 -i 参数提供图片文件路径。')
        return 1
    if not args.output:
        print('请通过 -o 参数提供导出文件夹路径。')
        return 1

    try:
        export_images(args.input, args.output, DummyLogger())
        return 0
    except Exception as exc:
        print('处理图片时发生错误：', exc)
        return 1


class DummyLogger:
    def write(self, *args, **kwargs):
        pass

    def flush(self):
        pass


class DummyText:
    def configure(self, **kwargs):
        pass

    def insert(self, index, text):
        pass

    def see(self, index):
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='图片导出工具 - Python GUI 版本')
    parser.add_argument('-i', '--input', type=Path, help='要处理的图片文件路径')
    parser.add_argument('-o', '--output', type=Path, help='导出目标文件夹路径')
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.input or args.output:
        return run_cli(args)

    if tk is None or filedialog is None or messagebox is None:
        print('当前环境不支持 tkinter GUI。请通过命令行运行。')
        return 1

    run_gui()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
