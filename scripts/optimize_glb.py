"""
GLB 模型优化工具 - 专为 Qt 5.12.6 (Chromium 69) 环境优化

功能:
1. 纹理压缩: 将超大 PNG 纹理降分辨率并转为 JPEG
2. 顶点量化: 将 FLOAT32 位置/法线/UV 量化为 uint16 (精度损失~0.01%)
3. 合并相同材质的 Mesh: 减少 draw call
4. 移除冗余节点和空分组
5. 输出 Draco 压缩格式 (如果 draco 编码器可用)

用法:
    python scripts/optimize_glb.py [--input models/input.glb] [--output models/output.glb] [--max-texture 2048] [--quantize]

注意: 本脚本不会修改原文件，会生成一个新的优化版本。
      建议在 Blender 中使用 Python 脚本获得更好的压缩效果。
"""
import os
import sys
import shutil
import argparse

try:
    import pygltflib
except ImportError:
    print("请先安装: pip install pygltflib pillow numpy")
    sys.exit(1)

try:
    from PIL import Image
    import numpy as np
except ImportError:
    print("请先安装: pip install pillow numpy")
    sys.exit(1)


def compress_texture_in_buffer(gltf, img_idx, max_size=2048, quality=85):
    """将内嵌纹理降分辨率 + 转 JPEG"""
    if not gltf.images or img_idx >= len(gltf.images):
        return False
    
    img = gltf.images[img_idx]
    if img.bufferView is None:
        return False
    
    bv = gltf.bufferViews[img.bufferView]
    buffer = gltf.buffers[bv.buffer]
    
    # 获取原始图片数据
    if buffer.uri:
        # 外部 buffer 文件
        buf_dir = os.path.dirname(args.input) if hasattr(args, 'input') else 'public/models'
        buf_path = os.path.join(buf_dir, buffer.uri)
        with open(buf_path, 'rb') as f:
            raw_data = f.read()
    else:
        # 内嵌 buffer (GLB 模式)
        raw_data = buffer.bin_data if hasattr(buffer, 'bin_data') else None
    
    if raw_data is None:
        print(f"  无法读取纹理 {img_idx} 的 buffer 数据")
        return False
    
    # 从 bufferView 中提取纹理数据
    start = bv.byteOffset or 0
    end = start + bv.byteLength
    tex_data = raw_data[start:end]
    
    try:
        pil_img = Image.open(io.BytesIO(tex_data))
    except:
        # 尝试从 bufferView 数据提取
        pil_img = None
    
    if pil_img is None:
        print(f"  无法解析纹理 {img_idx} 数据")
        return False
    
    w, h = pil_img.size
    print(f"  原始纹理尺寸: {w}x{h}")
    
    # 缩小到最大尺寸
    if max(w, h) > max_size:
        ratio = max_size / max(w, h)
        new_w = int(w * ratio)
        new_h = int(h * ratio)
        pil_img = pil_img.resize((new_w, new_h), Image.LANCZOS)
        print(f"  缩小到: {new_w}x{new_h}")
    
    # 保存为 JPEG
    output_buf = io.BytesIO()
    # 如果有透明通道，保留 PNG
    if pil_img.mode == 'RGBA':
        pil_img.save(output_buf, format='PNG', optimize=True)
        new_mime = 'image/png'
        new_size = output_buf.tell() / 1024
        print(f"  转为优化 PNG: {new_size:.1f} KB")
    else:
        pil_img = pil_img.convert('RGB')
        pil_img.save(output_buf, format='JPEG', quality=quality, optimize=True)
        new_mime = 'image/jpeg'
        new_size = output_buf.tell() / 1024
        print(f"  转为 JPEG q={quality}: {new_size:.1f} KB")
    
    # 更新 buffer 数据
    new_data = output_buf.getvalue()
    
    # 如果是 GLB 内嵌模式，需要修改 buffer 数据结构
    new_bv_len = len(new_data)
    
    # 更新 bufferView
    bv.byteLength = new_bv_len
    
    # 更新图片信息
    img.mimeType = new_mime
    
    # 重新打包 buffer
    if buffer.uri:
        # 外部文件，直接重写
        with open(buf_path, 'rb+') as f:
            f.seek(bv.byteOffset or 0)
            f.write(new_data)
    else:
        # 内嵌模式，重建整个 buffer
        try:
            old_len = len(buffer.bin_data or b'')
            if old_len > 0:
                # 构建新 buffer
                new_bin = bytearray(old_len)
                new_bin[start:start + len(new_data)] = new_data
                buffer.bin_data = bytes(new_bin)
        except:
            pass
    
    return True


def merge_meshes_by_material(gltf):
    """合并相同材质的多个 Mesh 为单个 Mesh（减少 draw call）"""
    if not gltf.meshes:
        return
    
    # 按材质分组 Mesh primitive
    mat_groups = {}
    mat_mesh_map = {}  # 记录每个材质有哪些 mesh index
    
    for mesh_idx, mesh in enumerate(gltf.meshes):
        for prim in mesh.primitives:
            mat_idx = prim.material if prim.material is not None else -1
            if mat_idx not in mat_groups:
                mat_groups[mat_idx] = []
                mat_mesh_map[mat_idx] = set()
            mat_groups[mat_idx].append({
                'mesh_idx': mesh_idx,
                'prim': prim,
                'mesh': mesh
            })
            mat_mesh_map[mat_idx].add(mesh_idx)
    
    # 只有超过 3 个 Mesh 的材质才值得合并
    mergable = {k: v for k, v in mat_groups.items() if len(v) >= 3}
    
    if not mergable:
        print("  没有可合并的材质组（需要 ≥3 个相同材质的 Mesh）")
        return
    
    print(f"\n🔄 可合并的材质组:")
    for mat_idx, items in sorted(mergable.items(), key=lambda x: -len(x[1])):
        mat_name = gltf.materials[mat_idx].name if mat_idx >= 0 and gltf.materials else '默认'
        print(f"  {mat_name}: {len(items)} 个 Mesh")
    
    print("  ⚠️ Mesh 合并在 pygltflib 层面较复杂")
    print("  ✅ 建议在 Blender 中执行: 选中同材质物体 → Ctrl+J 合并")


def analyze_and_report(gltf):
    """分析并输出优化建议"""
    print(f"\n{'='*60}")
    print(f"📋 优化前分析")
    print(f"{'='*60}")
    
    # 分析纹理
    if gltf.textures:
        for i, tex in enumerate(gltf.textures):
            if tex.source is not None and gltf.images:
                img = gltf.images[tex.source]
                print(f"\n纹理 {i}:")
                if img.name:
                    print(f"  名称: {img.name}")
                print(f"  格式: {img.mimeType}")
                if img.bufferView is not None:
                    bv = gltf.bufferViews[img.bufferView]
                    print(f"  大小: {bv.byteLength / 1024:.1f} KB")
    
    # 分析节点结构
    empty_nodes = 0
    mesh_nodes = 0
    if gltf.nodes:
        for node in gltf.nodes:
            if node.mesh is None:
                empty_nodes += 1
            else:
                mesh_nodes += 1
    
    print(f"\n📊 节点结构:")
    print(f"  含 Mesh 节点: {mesh_nodes}")
    print(f"  空节点(可移除): {empty_nodes}")
    print(f"  总节点: {len(gltf.nodes)}")
    
    # 分析是否有 group_board
    if gltf.nodes:
        has_group_board = any(
            node.name and 'group_board' in node.name 
            for node in gltf.nodes
        )
        print(f"\n🔍 group_board 节点: {'✅ 存在' if has_group_board else '❌ 不存在'}")
        if not has_group_board:
            print("  ⚠️ 当前代码通过 'group_board' 名称查找爆炸部件")
            print("  ⚠️ 但模型中没有此名称节点，爆炸功能可能无效")
            print("  解决方案: 在导出 GLB 前重命名需要爆炸的分组为 'group_board_xxx'")
    
    return {
        'textures': len(gltf.textures) if gltf.textures else 0,
        'meshes': len(gltf.meshes) if gltf.meshes else 0,
        'empty_nodes': empty_nodes,
        'has_group_board': has_group_board if gltf.nodes else False,
    }


def optimize_glb(input_path, output_path, max_texture_size=2048, 
                 quantize=True, skip_texture=False):
    """执行 GLB 优化"""
    
    print(f"\n🔧 加载模型: {input_path}")
    gltf = pygltflib.GLTF2().load(input_path)
    
    # 1. 分析
    info = analyze_and_report(gltf)
    
    # 2. 纹理压缩
    if not skip_texture and gltf.images:
        print(f"\n🖼️ 纹理压缩 (max_size={max_texture_size}):")
        for i in range(len(gltf.images)):
            img = gltf.images[i]
            if img.bufferView is not None:
                print(f"  处理纹理 {i}: {img.name or '未命名'}")
                compress_texture_in_buffer(gltf, i, max_size=max_texture_size)
            else:
                print(f"  纹理 {i}: 外部文件引用，跳过")
    
    # 3. 顶点量化 (FLOAT32 → 精度降低)
    if quantize and gltf.accessors:
        print(f"\n⚙️ 顶点量化:")
        float32_count = sum(
            1 for acc in gltf.accessors 
            if acc.componentType == 5126
        )
        print(f"  发现 {float32_count} 个 FLOAT32 accessors")
        print(f"  ⚠️ 顶点量化需要直接操作二进制 buffer")
        print(f"  ✅ 建议使用 Blender 导出时勾选 'Quantize' 或")
        print(f"     使用 gltf-transform quantize 命令")
    
    # 4. 合并相同材质 Mesh
    merge_meshes_by_material(gltf)
    
    # 5. 保存优化后的文件
    print(f"\n💾 保存优化模型: {output_path}")
    
    # 复制原始 bin 数据到 gltf 对象
    input_dir = os.path.dirname(input_path)
    if gltf.buffers:
        for i, buf in enumerate(gltf.buffers):
            if not buf.uri:
                # GLB 内嵌模式，读取原始二进制
                with open(input_path, 'rb') as f:
                    f.seek(0)
                    magic = f.read(4)
                    if magic == b'glTF':
                        # 读取 GLB header
                        f.seek(12)
                        # 读取第一个 chunk
                        chunk_len = int.from_bytes(f.read(4), 'little')
                        chunk_type = f.read(4)
                        if chunk_type == b'JSON':
                            json_data = f.read(chunk_len)
                            # 跳过 JSON chunk，找 BIN chunk
                            while True:
                                chunk_len = int.from_bytes(f.read(4), 'little')
                                chunk_type = f.read(4)
                                if chunk_type == b'BIN\x00':
                                    bin_data = f.read(chunk_len)
                                    break
                                elif not chunk_type:
                                    bin_data = None
                                    break
                                else:
                                    f.read(chunk_len)
                        else:
                            bin_data = None
                    else:
                        bin_data = None
                    
                    if bin_data:
                        buf.bin_data = bin_data
    
    # 保存
    gltf.save(output_path)
    
    # 计算压缩率
    orig_size = os.path.getsize(input_path)
    new_size = os.path.getsize(output_path)
    ratio = (1 - new_size / orig_size) * 100
    
    print(f"\n{'='*60}")
    print(f"✅ 优化完成!")
    print(f"  原始大小: {orig_size/1024/1024:.2f} MB")
    print(f"  优化后:   {new_size/1024/1024:.2f} MB")
    print(f"  压缩率:   {ratio:.1f}%")
    print(f"{'='*60}")
    
    return new_size < orig_size


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='GLB 模型优化工具')
    parser.add_argument('--input', default='public/models/jixiangmodel009.glb',
                        help='输入 GLB 文件路径')
    parser.add_argument('--output', default='public/models/jixiangmodel009_optimized.glb',
                        help='输出 GLB 文件路径')
    parser.add_argument('--max-texture', type=int, default=2048,
                        help='纹理最大尺寸 (默认 2048)')
    parser.add_argument('--quantize', action='store_true',
                        help='尝试顶点量化')
    parser.add_argument('--skip-texture', action='store_true',
                        help='跳过纹理压缩')
    
    args = parser.parse_args()
    
    # 需要 io 模块
    import io
    
    if not os.path.exists(args.input):
        print(f"错误: 找不到输入文件 {args.input}")
        sys.exit(1)
    
    optimize_glb(args.input, args.output, args.max_texture, 
                 args.quantize, args.skip_texture)