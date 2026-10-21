# 生成完整项目

运行命令前，把 `<Skill目录>` 替换为实际安装目录。脚本不依赖创建本 Skill 时的源项目或 GitHub 账号。

```bash
node "<Skill目录>/scripts/create-project.mjs" --dest "<项目绝对路径>" --name my-travel-globe
```

用户只想导入个人素材时，加 `--empty`。不指定 `--empty` 时自带 20 张演示照片、3 段视频和 23 张缩略图，可直接体验所有相册场景。示例的地区和日期是演示分类，不表示原素材的真实拍摄地点。

目标若非空，生成器会报错，不会覆盖。使用用户选择的目录；未明确目标时，可以在当前工作目录下建立一个不存在的新子目录并说明。不要重建用户已有应用，不自动初始化、关联、提交或推送 Git。

## 启动和验证

Node.js 需满足模板 Vite 的 engines（20.19+ 或 22.12+），运行实际 lockfile 安装：

```bash
cd "<项目绝对路径>"
npm ci
npm run dev
```

按终端提示访问，默认 http://127.0.0.1:5173/。手机同一局域网可执行 `npm run dev -- --host 0.0.0.0` 后访问电脑 IP。

```bash
npm run typecheck
npm run check:data
npm run build
```

数据检查和媒体导入需要 `ffmpeg`、`ffprobe`；只有启动/构建不需要。先检查工具是否已安装，缺失时按用户授权及实际环境安装（macOS 可用 `brew install ffmpeg`），不强制安装另一套运行时。

模板中的 `import:media` 是新增的个人素材导入命令。原来的 `prepare:media` 只用于重建在线演示媒体，会重写演示输出，不能用于个人照片。`prepare:map`、`prepare:land` 不属于正常启动步骤，地图已预处理并随模板提供。

模板保留素材 credit、第三方链接及字体 OFL 文本。不要擅自替换项目署名为当前用户或将演示画面描述为用户亲自拍摄。

## 文件职责

| 路径 | 用途 |
| --- | --- |
| `src/data/travels.json` | 地区、城市、封面及媒体索引 |
| `public/media/` | 网站实际加载的展示文件 |
| `public/data/world.topo.json` | 省州 ID 与同源国界/省界 |
| `public/data/world-land.bin` | 预生成矢量陆地几何 |
| `scripts/import-media.mjs` | 按明确计划导入个人素材，默认只读预检 |
| `scripts/check-data.mjs` | 地图、关联与媒体有效性校验 |

修改图形交互时，实际确认加载提示消失、陆地显示、只有当前国家展开；若用户禁止主动浏览器测试，交付人工 Todo，不把它说成已验证。

## 人工验收 Todo

- [ ] 地球旋转、缩放、重置正常，拖动不会误选地区。
- [ ] 默认国家边界清楚，只有聚焦国家展示省州。
- [ ] 访问相册后，城市、照片/视频筛选与计数一致。
- [ ] 全屏图片缩放、切换以及视频播放/暂停正常。
- [ ] 猫狗可独立拖动，靠近松手后互动。
- [ ] 空相册、无 WebGL 列表、加载重试与手机布局可用。
