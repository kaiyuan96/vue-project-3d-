import pygltflib

# 检查原始模型
orig = pygltflib.GLTF2().load('public/models/jixiangmodel009.glb')
print("=== 原始模型 ===")
print(f"节点总数: {len(orig.nodes)}")
for i, node in enumerate(orig.nodes or []):
    if node.name and 'group_board' in node.name.lower():
        print(f'  Node[{i}]: name="{node.name}", mesh={node.mesh}, children={node.children}')

print()

# 检查优化后模型
opt = pygltflib.GLTF2().load('public/models/jixiangmodel009_opt.glb')
print("=== 优化模型 ===")
print(f"节点总数: {len(opt.nodes)}")
found = False
for i, node in enumerate(opt.nodes or []):
    if node.name and 'group_board' in node.name.lower():
        found = True
        print(f'  Node[{i}]: name="{node.name}", mesh={node.mesh}, children={node.children}')

if not found:
    print("  ❌ 未找到任何 group_board 节点！")
    print("  Draco 压缩保留了节点名称但简化可能改变了结构")