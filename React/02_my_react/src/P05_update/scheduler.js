import {
  TAG_ROOT,
  ELEMENT_TEXT,
  TAG_TEXT,
  TAG_HOST,
  PLACEMENT,
  DELETION,
  UPDATE,
} from './constants';
import { setProps } from './utils';

let nextUnitOfWork = null; // 下一个工作单元
let workInProgressRoot = null; // RootFiber应用的根
let currentRoot = null; // 记录渲染成功之后的当前根RootFiber
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
  if (currentRoot) {
    // 至少渲染过一次了（update过程）
    rootFiber.alternate = currentRoot;
    workInProgressRoot = rootFiber;
  } else {
    // 第一次渲染（mount过程）
    workInProgressRoot = rootFiber;
  }

  nextUnitOfWork = rootFiber;
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
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && workInProgressRoot) {
    console.log('本次render阶段结束，开始commitRoot更新dom');
    console.log('fiber树：', workInProgressRoot);
    commitRoot();
  }

  window.requestIdleCallback(workLoop, { timeout: 500 });
}

function commitRoot() {
  // 执行effect list（即更新dom）之前先把该删除的元素删除
  deletions.forEach(commitWork);

  // 开始根据收集到的副作用链进行dom更新操作
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
  let domReturn = returnFiber.stateNode;
  if (currentFiber.effectTag === PLACEMENT) {
    // 处理新增节点
    let nextFiber = currentFiber;
    domReturn.appendChild(nextFiber.stateNode);
  } else if (currentFiber.effectTag === DELETION) {
    // 处理删除节点
    domReturn.removeChild(currentFiber.stateNode);
  } else if (currentFiber.effectTag === UPDATE) {
    // 处理节点的更新
    if (currentFiber.type === ELEMENT_TEXT) {
      // 更新的是文本节点
      // if (currentFiber.stateNode.textContent !== currentFiber.props.text)
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

/**
 * beginWork开始遍历每一个节点
 *
 * 1.创建真实DOM元素
 * 2.创建子fiber
 * @param {*} currentFiber
 */
function beginWork(currentFiber) {
  if (currentFiber.tag === TAG_ROOT) {
    updateHostRoot(currentFiber);
  } else if (currentFiber.tag === TAG_TEXT) {
    updateHostText(currentFiber);
  } else if (currentFiber.tag === TAG_HOST) {
    // stateNode是原生dom
    updateHost(currentFiber);
  }
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
  const newChildren = currentFiber.props.children;
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
 * 调和，将虚拟dom转成fiber节点，即：虚拟dom树 -> fiber树，并且会执行dom diff操作
 * @param {*} currentFiber
 * @param {*} newChildren
 */
function reconcileChildren(currentFiber, newChildren) {
  let newChildIndex = 0; // 新子节点的索引
  let prevSibiling; // 上一个新的子fiber

  // 遍历我们子虚拟DOM元素数组，为每一个虚拟DOM创建子Fiber
  // 创建该虚拟dom对应的fiber节点：虚拟dom -> fiber
  while (newChildren && newChildIndex < newChildren.length) {
    let newChild = newChildren[newChildIndex]; // 取出虚拟DOM节点
    let newFiber;
    if (typeof newChild === 'string') {
      // 处理文本节点
      newFiber = {
        tag: TAG_TEXT,
        type: ELEMENT_TEXT,
        props: { text: newChild },
        stateNode: null, // div还没有创建DOM元素
        return: currentFiber, // 父Fiber returnFiber
        effectTag: PLACEMENT, // 副作用标示，render会收集副作用 增加 删除 更新
        nextEffect: null, // effect list也是一个单链表 顺序和完成顺序一样 节点可能会少
      };
    } else if (newChild && typeof newChild.type === 'string') {
      // 处理原生dom节点
      newFiber = {
        tag: TAG_HOST, // 如果type是字符串，那么这是一个原生DOM节点（div）,
        type: newChild.type,
        props: newChild.props,
        stateNode: null, // div还没有创建DOM元素
        return: currentFiber, // 父Fiber returnFiber
        effectTag: PLACEMENT, // 副作用标示，render会收集副作用 增加 删除 更新
        nextEffect: null, // effect list也是一个单链表 顺序和完成顺序一样 节点可能会少
      };
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
