import {
  TAG_ROOT,
  ELEMENT_TEXT,
  TAG_TEXT,
  TAG_HOST,
  PLACEMENT,
  DELETION,
  UPDATE,
  TAG_CLASS,
} from './constants';
import { UpdateQueue } from './updateQueue';
import { setProps, isSameType, convertTextNode } from './utils';

let nextUnitOfWork = null; // 下一个工作单元
let workInProgressRoot = null; // RootFiber应用的根（内存中下次渲染的fiber树）
let currentRoot = null; // 记录渲染成功之后的当前根RootFiber -> 即：缓存当前的fiber树 -> 用于下次更新做比对
let deletions = []; // 删除的节点我们并不放在effect list里，所以需要单独记录并执行

/**
 * 从根节点开始渲染和调度
 * 两个阶段（diff+render阶段，commit阶段）
 * diff+render阶段 对比新旧虚拟DOM，进行增量更新或创建
 * 花时间长，可进行任务拆分，此阶段可暂停
 * render阶段的成果是effect list知道哪些节点更新哪些节点增加删除了
 * render阶段两个任务：1.根据虚拟DOM生成fiber树 2.收集effectlist
 * commit阶段，进行DOM更新创建阶段，此间断不能暂停
 * @param { tag: TAG_ROOT, stateNode: container, props: { children: [element] } rootFiber
 */
export function scheduleRoot(rootFiber) {
  if (currentRoot && currentRoot.alternate) {
    // 渲染两次后才会形成两棵Fiber树，第三次开始，就可以启用双缓冲渲染
    // 第三次（包括第三次）之后的渲染（update过程），不能每次都创建树，如起始时可以把第一个树赋给第三个
    workInProgressRoot = currentRoot.alternate; // 这就是第二次之后渲染，不能每次都创建树，如起始时可以把第一个树赋给第三个
    workInProgressRoot.alternate = currentRoot; // 他的替身指向当前树
    if (rootFiber) {
      workInProgressRoot.props = rootFiber.props; // 让他的props更新成新的props
    }
  } else if (currentRoot) {
    // 第二次渲染（update过程）
    if (rootFiber) {
      rootFiber.alternate = currentRoot;
      workInProgressRoot = rootFiber;
    } else {
      workInProgressRoot = {
        ...currentRoot,
        alternate: currentRoot,
      };
    }
  } else {
    // 第一次渲染（mount过程）
    workInProgressRoot = rootFiber;
  }

  // 清理上次的副作用链
  workInProgressRoot.firstEffect =
    workInProgressRoot.lastEffect =
    workInProgressRoot.nextEffect =
      null;

  // 触发执行工作循环
  nextUnitOfWork = workInProgressRoot;
}

function performUnitOfWork(currentFiber) {
  beginWork(currentFiber);
  if (currentFiber.child) {
    return currentFiber.child;
  }
  while (currentFiber) {
    completeUnitOfWork(currentFiber);
    if (currentFiber.sibling) {
      return currentFiber.sibling;
    }
    currentFiber = currentFiber.return;
  }
}

function workLoop(deadline) {
  console.log('持续监听中...');

  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && workInProgressRoot) {
    console.log(
      '本次render阶段结束，开始commitRoot更新dom，fiber树：',
      workInProgressRoot,
    );
    commitRoot();
  }

  window.requestIdleCallback(workLoop, { timeout: 500 });
}

function commitRoot() {
  deletions.forEach(commitWork); // 执行effect list之前先把该删除的元素删除

  let currentFiber = workInProgressRoot.firstEffect;
  while (currentFiber) {
    commitWork(currentFiber);
    currentFiber = currentFiber.nextEffect;
  }

  deletions.length = 0; // 记得清空数组
  currentRoot = workInProgressRoot; // 把当前渲染成功的根fiber赋值给currentRoot，用于下次更新前做比对
  workInProgressRoot = null;
}

function commitWork(currentFiber) {
  if (!currentFiber) return;

  let returnFiber = currentFiber.return;
  // 单独处理类组件、函数组件的挂载点
  while (
    returnFiber.tag !== TAG_HOST &&
    returnFiber.tag !== TAG_ROOT &&
    returnFiber.tag !== TAG_TEXT
  ) {
    returnFiber = returnFiber.return;
  }
  let domReturn = returnFiber.stateNode;

  if (currentFiber.effectTag === PLACEMENT) {
    // 处理新增节点
    let nextFiber = currentFiber;
    if (nextFiber.tag === TAG_CLASS) {
      return;
    }
    //如果要挂载的节点不是dom节点，比如说是类组件fiber，一直找第一个儿子，直到找到真实DOM
    while (nextFiber.tag !== TAG_HOST && nextFiber.tag !== TAG_TEXT) {
      nextFiber = currentFiber.child;
    }
    domReturn.appendChild(nextFiber.stateNode);
  } else if (currentFiber.effectTag === DELETION) {
    // 处理删除节点
    return commitDeletion(currentFiber, domReturn);
  } else if (currentFiber.effectTag === UPDATE) {
    // 处理节点的更新
    if (currentFiber.type === ELEMENT_TEXT) {
      // 更新的是文本节点
      // 与上一次的fiber节点（老的fiber节点）进行比较
      if (currentFiber.alternate.props.text !== currentFiber.props.text)
        currentFiber.stateNode.textContent = currentFiber.props.text;
    } else {
      updateDOM(
        currentFiber.stateNode,
        currentFiber.alternate.props,
        currentFiber.props,
      );
    }
  }

  currentFiber.effectTag = null;
}

function commitDeletion(currentFiber, domReturn) {
  if (currentFiber.tag === TAG_HOST || currentFiber.tag === TAG_TEXT) {
    domReturn.removeChild(currentFiber.stateNode);
  } else {
    commitDeletion(currentFiber.child, domReturn);
  }
}

/**
 * beginWork开始遍历每一个节点
 *
 * 1.创建真实DOM元素
 * 2.创建子fiber
 * @param {*} currentFiber
 */
function beginWork(currentFiber) {
  if (currentFiber.tag === TAG_ROOT) {
    // 根fiber
    updateHostRoot(currentFiber);
  } else if (currentFiber.tag === TAG_TEXT) {
    // 文本fiber
    updateHostText(currentFiber);
  } else if (currentFiber.tag === TAG_HOST) {
    // 原生dom fiber，stateNode是原生dom
    updateHost(currentFiber);
  } else if (currentFiber.tag === TAG_CLASS) {
    // 类组件
    updateClassComponent(currentFiber);
  }
}

function updateClassComponent(currentFiber) {
  if (!currentFiber.stateNode) {
    // 类组件 stateNode 是组件的实例（原生dom fiber，stateNode是原生dom）
    // currentFiber.type 是 Counter 类组件 fiber双向指向
    currentFiber.stateNode = new currentFiber.type(currentFiber.props);
    currentFiber.stateNode.internalFiber = currentFiber;
    currentFiber.updateQueue = new UpdateQueue(); // 更新队列
  }

  // 给组件的实例state赋值
  currentFiber.stateNode.state = currentFiber.updateQueue.forceUpdate(
    currentFiber.stateNode.state,
  );
  let newElement = currentFiber.stateNode.render();
  const newChildren = [newElement];
  reconcileChildren(currentFiber, newChildren);
}

function updateHostRoot(currentFiber) {
  // 先处理自己 如果是一个原生节点，创建真实DOM 2.创建子fiber
  let newChildren = currentFiber.props.children; // [element]
  reconcileChildren(currentFiber, newChildren); // reconcile协调
}

function updateHostText(currentFiber) {
  if (!currentFiber.stateNode) {
    // 如果此fiber没有创建DOM节点
    currentFiber.stateNode = createDom(currentFiber);
  }
}

function updateHost(currentFiber) {
  if (!currentFiber.stateNode) {
    // 如果此fiber没有创建DOM节点，那么就创建
    currentFiber.stateNode = createDom(currentFiber);
  }
  let newChildren = currentFiber.props.children;
  // 类组件字符串、数字节点的兼容性处理
  if (typeof newChildren === 'number' || typeof newChildren === 'string') {
    newChildren = [newChildren + ''];
  }
  reconcileChildren(currentFiber, newChildren);
}

function createDom(currentFiber) {
  if (currentFiber.tag === TAG_TEXT) {
    return document.createTextNode(currentFiber.props.text);
  } else if (currentFiber.tag === TAG_HOST) {
    let stateNode = document.createElement(currentFiber.type);
    updateDOM(stateNode, {}, currentFiber.props);
    return stateNode;
  }
}

function updateDOM(stateNode, oldProps, newProps) {
  if (stateNode && stateNode.setAttribute) {
    setProps(stateNode, oldProps, newProps);
  }
}

/**
 * 调和，将虚拟dom转成fiber节点，即：虚拟dom树 -> fiber树，
 * 并且会执行dom diff操作、会收集待删除的fiber节点（即：待删除的dom）
 * @param {*} currentFiber
 * @param {*} newChildren
 */
function reconcileChildren(currentFiber, newChildren) {
  let newChildIndex = 0; // 新子节点的索引
  let prevSibiling; // 上一个新的子fiber

  // 如果currentFiber有alternate，并且有currentFiber.alternate.child，说明是更新，需要做dom diff
  let oldFiber = currentFiber.alternate && currentFiber.alternate.child;
  if (oldFiber) {
    oldFiber.firstEffect = oldFiber.lastEffect = oldFiber.nextEffect = null;
  }

  // 遍历我们子虚拟DOM元素数组，为每一个虚拟DOM创建子Fiber
  // 创建该虚拟dom对应的fiber节点：虚拟dom -> fiber
  while ((newChildren && newChildIndex < newChildren.length) || oldFiber) {
    let newFiber;
    let newChild = newChildren[newChildIndex]; // 取出虚拟DOM节点
    let sameType = isSameType(newChild, oldFiber); // 节点类型一样可以复用，不一样则要删除再新增

    if (sameType) {
      // 节点类型一样可以复用（dom节点上有非常多的属性，在已经创建出来的时候，如果可以复用要尽量复用，减少重新开辟内存以及垃圾回收的开销）
      // 同样的，一颗fiber树已经有居多的节点了，如果能复用前一棵fiber树，形成双缓冲，这样可以尽可能地减少不断地内存开辟和垃圾回收
      // 说明老fiber和新虚拟DOM类型一样，可以复用，更新即可
      if (oldFiber.alternate) {
        // 至少已经更新一次了
        newFiber = oldFiber.alternate;
        newFiber.props = convertTextNode(newChild);
        newFiber.alternate = oldFiber;
        newFiber.effectTag = UPDATE;
        newFiber.updateQueue = oldFiber.updateQueue || new UpdateQueue();
        newFiber.nextEffect = null;
      } else {
        newFiber = {
          tag: oldFiber.tag,
          type: oldFiber.type,
          props: convertTextNode(newChild), // 一定要新的
          stateNode: oldFiber.stateNode, // div还没有创建DOM元素
          return: currentFiber, // 父Fiber returnFiber
          alternate: oldFiber, // 让新的fiber的alternate指向老的fiber
          effectTag: UPDATE, // 副作用标示，render会收集副作用 增加 删除 更新
          updateQueue: oldFiber.updateQueue || new UpdateQueue(),
          nextEffect: null, // effect list也是一个单链表 顺序和完成顺序一样 节点可能会少
        };
      }
    } else {
      // 新、老fiber节点类型不一样，无法复用老的fiber，需要创建新的fiber，则要删除再新增
      if (newChild) {
        let tag;
        let type;
        let props;
        if (
          typeof newChild.type == 'function' &&
          newChild.type.prototype.isReactComponent
        ) {
          // 是类组件
          tag = TAG_CLASS;
          type = newChild.type;
          props = newChild.props;
        } else if (typeof newChild === 'string') {
          // 是文本节点
          tag = TAG_TEXT;
          type = ELEMENT_TEXT;
          props = convertTextNode(newChild);
        } else if (typeof newChild.type === 'string') {
          // 如果type是字符串，那么这是一个原生DOM节点div
          tag = TAG_HOST;
          type = newChild.type;
          props = newChild.props;
        }

        // 看看新的虚拟dom是不是不为null
        newFiber = {
          tag,
          type,
          props,
          stateNode: null, // div还没有创建DOM元素
          return: currentFiber, // 父Fiber returnFiber
          effectTag: PLACEMENT, // 副作用标示，render会收集副作用 增加 删除 更新
          updateQueue: new UpdateQueue(),
          nextEffect: null, // effect list也是一个单链表 顺序和完成顺序一样 节点可能会少
        };
      }
      // 并且删除老节点
      if (oldFiber) {
        oldFiber.effectTag = DELETION;
        deletions.push(oldFiber);
      }
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling; // oldFiber指针也向后移动
    }

    // beginWork通过虚拟dom创建对应的fiber，虚拟dom树 -> fiber树
    // completeUnitOfWork的时候手机effect

    // 赋值指针，构建fiber数据结构中的 child、sibling、return 指针，由【虚拟dom树】 形成 【fiber树】
    if (newFiber) {
      if (newChildIndex === 0) {
        // 如果索引是0，就是大儿子
        currentFiber.child = newFiber;
      } else {
        prevSibiling.sibling = newFiber; // 大儿子指向弟弟
      }
      prevSibiling = newFiber;
    }

    newChildIndex++;
  }
}

/**
 * 在完成时收集副作用 组成effect list
 * 每个fiber有两个属性：
 * 1、firstEffect指向第一个有副作用的子fiber
 * 2、lastEffect指向最后一个有副作用的子fiber
 * 3、中间用nextEffect做成单链表
 * @param {*} currentFiber
 */
function completeUnitOfWork(currentFiber) {
  let returnFiber = currentFiber.return;
  if (returnFiber) {
    if (!returnFiber.firstEffect) {
      returnFiber.firstEffect = currentFiber.firstEffect;
    }

    if (currentFiber.lastEffect) {
      if (returnFiber.lastEffect) {
        returnFiber.lastEffect.nextEffect = currentFiber.firstEffect;
      }
      returnFiber.lastEffect = currentFiber.lastEffect;
    }

    const effectTag = currentFiber.effectTag;
    if (effectTag) {
      // 如果有副作用，（第一次时肯定有，新增默认PLACEMENT）
      if (returnFiber.lastEffect) {
        returnFiber.lastEffect.nextEffect = currentFiber;
      } else {
        returnFiber.firstEffect = currentFiber;
      }
      returnFiber.lastEffect = currentFiber;
    }
  }
}

// react询问浏览器是否空闲，这里有个优先级的概念 expirationTime
window.requestIdleCallback(workLoop, { timeout: 500 });
