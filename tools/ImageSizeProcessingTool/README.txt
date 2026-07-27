图片尺寸处理工具

这是一个本地 Python 图形界面工具，用于：

- 选择一张本地图像
- 选择一个导出目录
- 自动在导出目录中创建一个日期子文件夹（例如 20260728_001）
- 生成三张网页适用尺寸图片：400px、800px、1200px
- 将原图复制到同一子文件夹中

文件结构

- image_export_tool.pyw：可直接双击打开的 GUI 版本工具

使用前准备

1. 安装 Python

   - 访问 https://www.python.org/downloads/ 下载并安装 Python
   - Windows 安装时建议勾选“Add Python to PATH”

2. 安装 Pillow

   打开终端或 PowerShell，运行：

   python -m pip install pillow

   如果 python 命令不可用，可改用：

   py -m pip install pillow

使用方法

1. 双击 image_export_tool.pyw，打开操作窗口
2. 点击“浏览图片…”选择需要处理的图片
3. 点击“浏览目录…”选择导出文件夹
4. 点击“开始生成”

导出完成后，工具会自动打开生成结果所在的子文件夹。

注意事项

- 若未安装 Pillow，程序会提示安装
- 如果 tkinter 未安装，则无法显示图形界面，可改用命令行方式运行脚本
- 若想使用命令行运行，请使用 python image_export_tool.pyw -i <输入图片> -o <输出目录>
