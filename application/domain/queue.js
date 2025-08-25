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
  onFailure: (err, res) => console.error('Order error:', res, err),
  onDone: null,
  onDrain() {
    console.warn('send drain. size:', this.size, 'sent:', this.sent);
    this.size = 0;
    this.sent = 0;
  },
  addTask(task) {
    this.queue.push({ task, start: Date.now() });
    this.size++;
    if (this.queue.length === 1) this.takeNext();
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
      this.finish(error, res);
      if (this.queue.length > 0) setTimeout(() => this.takeNext(), 0);
    };

    if (this.processTimeout !== Infinity) {
      timer = setTimeout(() => {
        timer = null;
        const err = new Error('Process timed out');
        finish(err, task);
      }, this.processTimeout);
    }
    this.send(task, finish);
  },
  takeNext() {
    const { task, start } = this.queue.shift();
    if (this.waitTimeout !== Infinity) {
      if (Date.now() - start > this.waitTimeout) {
        const error = new Error('Waiting timed out');
        this.finish(error, task);
        if (this.queue.length > 0) {
          setTimeout(() => {
            if (this.queue.length > 0) this.takeNext();
          }, 0);
        }
        return;
      }
    }
    if (this.count < this.concurrency) this.next(task);
  },
  finish(error, res) {
    if (error) {
      if (this.onFailure) this.onFailure(error, res);
    } else if (this.onSuccess) {
      this.onSuccess(res);
    }
    // if (this.onDone) this.onDone(error, res);
    if (this.count === 0 && this.onDrain) this.onDrain();
  },
  async send({ endpoint, data }, finish) {
    this.sent++;
    finish(null, await lib.ptfin.sendPost({ method: 'POST', endpoint, data }));
  },
});
