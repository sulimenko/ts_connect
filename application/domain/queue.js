({
  queue: [],

  concurrency: 20,
  count: 0,

  size: 0,
  sent: 0,

  waitTimeout: Infinity,
  processTimeout: Infinity,

  onTimeout: null,
  // eslint-disable-next-line no-unused-vars
  onSuccess: (res) => {
    // if (res.success?.[0]?.advice !== undefined) console.info(JSON.stringify(res.success[0].advice));
  },
  onFailure(err) {
    console.error('downstream queue failure', {
      error: err?.message ?? err,
      queueCount: this.count,
      queueLength: this.queue.length,
    });
  },
  onDone: null,
  onDrain() {
    console.warn('send drain. size:', this.size, 'sent:', this.sent);
    // console.warn('send drain. queue:', JSON.stringify(this.queue));
    this.size = 0;
    this.sent = 0;
  },
  notify(callback, ...args) {
    if (typeof callback !== 'function') return;
    try {
      Promise.resolve(callback(...args)).catch((error) => console.error('queue callback failure', error));
    } catch (error) {
      console.error('queue callback failure', error);
    }
  },
  finish(error, res, task) {
    if (error) {
      this.notify(task?.onFailure, error, res);
      this.notify(this.onFailure?.bind(this), error, res);
    } else {
      this.notify(task?.onSuccess, res);
      this.notify(this.onSuccess?.bind(this), res);
    }
    this.notify(this.onDone?.bind(this), error, res);
    if (this.count === 0) this.notify(this.onDrain?.bind(this));
  },
  next(task) {
    this.count++;
    let timer = null;
    let finished = false;

    const finish = (error, res) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      this.count--;
      this.finish(error, res, task);
      if (this.queue.length > 0) setTimeout(() => this.takeNext(), 0);
    };

    if (this.processTimeout !== Infinity) {
      timer = setTimeout(() => {
        timer = null;
        const err = new Error('Process timed out');
        finish(err, task);
      }, this.processTimeout);
    }
    try {
      Promise.resolve(this.send(task, finish)).catch((error) => finish(error, task));
    } catch (error) {
      finish(error, task);
    }
  },
  takeNext() {
    const item = this.queue.shift();
    if (!item) return;
    const { task, start } = item;

    if (this.waitTimeout !== Infinity) {
      if (Date.now() - start > this.waitTimeout) {
        const error = new Error('Waiting timed out');
        this.finish(error, task, task);
        if (this.queue.length > 0) {
          setTimeout(() => {
            if (this.queue.length > 0) this.takeNext();
          }, 0);
        }
        return;
      }
    }

    if (this.count < this.concurrency) {
      this.next(task);
    } else {
      this.queue.unshift({ task, start });
    }
  },
  addTask(task) {
    this.queue.push({ task, start: Date.now() });
    this.size++;
    // console.log('send addTask. size:', this.size, 'OrderID', task.data.data.OrderID)
    if (this.queue.length === 1) this.takeNext();
  },
  async send({ endpoint, data }, finish) {
    this.sent++;
    // console.log('send sent:', this.sent, 'OrderID', data.data.OrderID)
    const result = await lib.ptfin.send({ method: 'POST', endpoint, data });
    finish(null, result);
    return result;
  },
});
