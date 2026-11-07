# PDF 转换容器（E08）

后端仍按原方式启动。Docker Desktop / Docker Engine 需在同一主机运行，使用支持 memory.max 的 Linux cgroup v2。

在仓库根构建一次：

```sh
backend/.venv/bin/python backend/scripts/build_pdf_worker.py
```

脚本只把 Dockerfile 和 worker 源文件复制到本次临时构建目录，不发送 `.env`、材料或整个后端目录。基础 Python 镜像固定 digest，pypdf 固定 6.19.0。构建阶段需要访问镜像/包源；本地镜像已存在且 BuildKit 无法访问 Docker Hub 时，可在同一命令前设 `DOCKER_BUILDKIT=0` 复用本地缓存。转换阶段 `--pull=never`，不联网下载镜像。

每次转换创建独立容器：非 root、根文件系统只读、禁网、移除 capabilities、no-new-privileges、512MiB 内存与内存交换合计、1 CPU、32 PID。仅挂载本次临时输入（只读）与输出目录。worker 额外检查 cgroup 限制、设置地址空间上限和60秒 alarm；后端最多等待60秒执行并按唯一归属标签核对后删除本次容器。Docker/镜像不可用返回503，不回退到不受限解析。

仅支持普通 PDF 页内容，不接受加密、表单、脚本、附件、链接、批注等主动内容。每次提取输出一个片段。产物仍须人工预览和确认应用，并重新检测匿名信息。该容器不替代现有上传/匿名检测的解析流程。
