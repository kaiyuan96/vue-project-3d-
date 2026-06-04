"""分析 GLB 模型结构，统计顶点数、材质、纹理等信息"""
import os
import sys

try:
    import pygltflib
except ImportError:
    print("请先安装 pygltflib: pip install pygltflib")
    sys.exit(1)

model_path = "public/models/jixiangmodel009.glb"

if not os.path.exists(model_path):
    print(f"文件不存在: {model_path}")
    sys.exit(1)

gltf = pygltflib.GLTF2().load(model_path)

print(f"{'='*60}")
print(f"模型分析报告: {model_path}")
print(f"{'='*60}")

# 基本信息
size_mb = os.path.getsize(model_path) / 1024 / 1024
print(f"\n📦 文件大小: {size_mb:.2f} MB")

# 场景信息
for i, scene in enumerate(gltf.scenes or []):
    print(f"\n📍 场景 {i}: {scene.name or '未命名'} - {len(scene.nodes)} 个根节点")

# 节点统计
node_count = len(gltf.nodes) if gltf.nodes else 0
mesh_count = 0
total_triangles = 0
for node in (gltf.nodes or []):
    if node.mesh is not None:
        mesh_count += 1
        mesh = gltf.meshes[node.mesh]
        for prim in mesh.primitives:
            if prim.indices is not None:
                accessor = gltf.accessors[prim.indices]
                total_triangles += accessor.count // 3
            else:
                pos_idx = prim.attributes.POSITION
                if pos_idx is not None:
                    pos_acc = gltf.accessors[pos_idx]
                    total_triangles += pos_acc.count // 3

print(f"\n🔷 节点总数: {node_count}")
print(f"🔺 Mesh 数量: {mesh_count}")
print(f"📐 总三角形数: {total_triangles:,}")

# 顶点统计
total_vertices = 0
for mesh in (gltf.meshes or []):
    for prim in mesh.primitives:
        pos_idx = prim.attributes.POSITION
        if pos_idx is not None:
            acc = gltf.accessors[pos_idx]
            total_vertices += acc.count

print(f"💠 总顶点数(含重复): {total_vertices:,}")

# 材质和纹理统计
material_count = len(gltf.materials) if gltf.materials else 0
texture_count = len(gltf.textures) if gltf.textures else 0
image_count = len(gltf.images) if gltf.images else 0

print(f"\n🎨 材质数量: {material_count}")
print(f"🖼️ 纹理数量: {texture_count}")
print(f"📷 图像数量: {image_count}")

# 纹理尺寸和格式
if gltf.images:
    total_tex_size = 0
    for i, img in enumerate(gltf.images):
        if img.uri:
            tex_path = os.path.join(os.path.dirname(model_path), img.uri)
            if os.path.exists(tex_path):
                sz = os.path.getsize(tex_path) / 1024
                total_tex_size += sz
                print(f"  纹理 {i}: {img.name or '未命名'} - {img.uri} ({sz:.1f} KB)")
            else:
                print(f"  纹理 {i}: {img.name or '未命名'} - {img.uri} (外部文件)")
        elif img.bufferView is not None:
            bv = gltf.bufferViews[img.bufferView]
            sz = bv.byteLength / 1024
            total_tex_size += sz
            mime = img.mimeType or '未知'
            print(f"  纹理 {i}: {img.name or '未命名'} - 内嵌 {mime} ({sz:.1f} KB)")
    
    if total_tex_size > 0:
        print(f"  纹理总大小: {total_tex_size:.1f} KB ({total_tex_size/1024:.1f} MB)")

# 访问器格式精度分析
print(f"\n⚙️ 访问器精度分析:")
format_names = {
    5120: "INT8", 5121: "UINT8", 5122: "INT16", 5123: "UINT16",
    5125: "UINT32", 5126: "FLOAT32"
}
if gltf.accessors:
    float_accessors = 0
    for i, acc in enumerate(gltf.accessors):
        fname = format_names.get(acc.componentType, f"未知({acc.componentType})")
        if acc.componentType == 5126:
            float_accessors += 1
        if i < 5:
            print(f"  Accessor {i}: type={acc.type}, format={fname}, count={acc.count}")
    
    total_accs = len(gltf.accessors)
    print(f"  ... 共 {total_accs} 个 accessors")
    print(f"  FLOAT32 accessors: {float_accessors} 个（可量化为 uint16 节省空间）")

# Buffer 统计
if gltf.buffers:
    total_buf_size = 0
    for i, buf in enumerate(gltf.buffers):
        if buf.uri:
            buf_path = os.path.join(os.path.dirname(model_path), buf.uri)
            if os.path.exists(buf_path):
                sz = os.path.getsize(buf_path)
            else:
                sz = 0
        else:
            sz = buf.byteLength
        total_buf_size += sz
        print(f"\n💾 Buffer {i}: {sz/1024/1024:.2f} MB (uri={buf.uri or '内嵌'})")

# Mesh 节点名称统计（帮助识别可合并的部件）
if gltf.nodes:
    group_board_count = 0
    mesh_names = []
    for node in gltf.nodes:
        if node.mesh is not None:
            mesh_names.append(node.name or '未命名')
            if node.name and 'group_board' in node.name:
                group_board_count += 1
    
    print(f"\n🔖 包含 'group_board' 的节点: {group_board_count}")
    if group_board_count <= 20:
        for name in mesh_names:
            if 'group_board' in name:
                print(f"  - {name}")

# 统计每个材质使用的 Mesh 数量（识别可合并的 Mesh）
if gltf.meshes:
    material_usage = {}
    for i, mesh in enumerate(gltf.meshes):
        for prim in mesh.primitives:
            mat_idx = prim.material if prim.material is not None else -1
            if mat_idx not in material_usage:
                material_usage[mat_idx] = 0
            material_usage[mat_idx] += 1
    
    print(f"\n🔗 按材质统计 Mesh 数量（可合并优化draw call）:")
    for mat_idx, count in sorted(material_usage.items(), key=lambda x: -x[1]):
        mat_name = gltf.materials[mat_idx].name if mat_idx >= 0 and gltf.materials else f'材质{mat_idx}'
        if mat_idx == -1:
            mat_name = "默认材质(无)"
        print(f"  {mat_name}: {count} 个 Mesh")

# 估算可压缩率
print(f"\n{'='*60}")
print(f"📊 压缩潜力评估:")
print(f"  原始大小: {size_mb:.2f} MB")
print(f"  Draco 压缩预估: 可降至 30-80 MB (压缩率 70-90%)")
print(f"  顶点量化: 将 FLOAT32 位置量化为 uint16, 数据量减半")
print(f"  纹理压缩: 内嵌纹理可转为 JPEG/降低分辨率")
print(f"  合并冗余: 相同材质的 Mesh 可合并减少 Draw Call")
print(f"{'='*60}")